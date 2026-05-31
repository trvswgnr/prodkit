import { TimeoutError, UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { sleepWithSignal } from "../shared.js";
import { RegisterExitFinalizerInstruction, SuspendInstruction } from "../core/instructions.js";
import { createRunContext } from "../core/runtime.js";
import { normalizeRetryPolicy, type NormalizedRetryPolicy } from "./retry-policy.js";
import { validateTimeoutMs } from "./validate.js";
import type { EnterFn, ExitFn, ReleaseFn, RunContext, TrackedErr } from "../core/types.js";
import {
  createPlan,
  executePlanInterruptOnAbort,
  type Plan,
  type PlanRewriter,
} from "../core/plan/base.js";
import { onEnterPlan, onExitPlan } from "../core/plan/lifecycle.js";
import { mapErrPlan, mapPlan, recoverPlan, tapErrPlan, tapPlan } from "../core/plan/transforms.js";

class DelegatingPlanRewriter implements PlanRewriter {
  apply!: PlanRewriter["apply"];

  release<T, E, M>(source: Plan<T, E, M>, release: ReleaseFn<T>): Plan<unknown, unknown, unknown> {
    return releasePlan(source.rewrite<T, E, M>(this), release);
  }

  enter<T, E, A, M>(
    source: Plan<T, E, M>,
    initialize: EnterFn<A>,
  ): Plan<unknown, unknown, unknown> {
    return onEnterPlan(source.rewrite<T, E, M>(this), initialize);
  }

  exit<T, E, A, M>(
    source: Plan<T, E, M>,
    finalize: ExitFn<T, E, A>,
  ): Plan<unknown, unknown, unknown> {
    return onExitPlan(source.rewrite<T, E, M>(this), finalize);
  }

  map<T, E, U, M>(
    source: Plan<T, E, M>,
    transform: (value: T) => U,
  ): Plan<unknown, unknown, unknown> {
    return mapPlan(source.rewrite<T, E, M>(this), transform);
  }

  tap<T, E, R, M>(
    source: Plan<T, E, M>,
    observe: (value: T) => R,
  ): Plan<unknown, unknown, unknown> {
    return tapPlan(source.rewrite<T, E, M>(this), observe);
  }

  mapErr<T, E, E2, M>(
    source: Plan<T, E, M>,
    transform: (error: TrackedErr<E>) => E2,
  ): Plan<unknown, unknown, unknown> {
    return mapErrPlan(source.rewrite<T, E, M>(this), transform);
  }

  tapErr<T, E, R, M>(
    source: Plan<T, E, M>,
    observe: (error: TrackedErr<E>) => R,
  ): Plan<unknown, unknown, unknown> {
    return tapErrPlan(source.rewrite<T, E, M>(this), observe);
  }

  recover<T, E, ECaught extends TrackedErr<E>, R, M>(
    source: Plan<T, E, M>,
    predicate: (error: TrackedErr<E>) => error is ECaught,
    handler: (error: ECaught) => R,
  ): Plan<unknown, unknown, unknown> {
    return recoverPlan(source.rewrite<T, E, M>(this), predicate, handler);
  }
}

function createDelegatingRewriter(apply: PlanRewriter["apply"]): PlanRewriter {
  const rewriter = new DelegatingPlanRewriter();
  rewriter.apply = apply;
  return rewriter;
}

export function releasePlan<T, E, M>(source: Plan<T, E, M>, release: ReleaseFn<T>): Plan<T, E, M> {
  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      if (result.isErr()) return yield* result;

      yield new RegisterExitFinalizerInstruction(() =>
        Promise.resolve(release(result.value)).then(() => {}),
      );

      return result.value;
    },
    {
      rewrite: (self, rewriter) => rewriter.release?.(source, release) ?? rewriter.apply(self),
    },
  );
}

export function retryPlan<T, E, M>(
  source: Plan<T, E, M>,
  policy: NormalizedRetryPolicy = normalizeRetryPolicy(),
): Plan<T, E, M> {
  return createPlan(function* () {
    try {
      policy.validate();
    } catch (cause) {
      return yield* Result.err(new UnhandledException({ cause }));
    }

    let attempt = 1;

    while (true) {
      type AttemptStep = { result: Result<T, E | UnhandledException>; aborted: boolean };
      const attemptStep: AttemptStep = yield* new SuspendInstruction((context) =>
        source.execute(context).then((result) => ({ result, aborted: context.signal.aborted })),
      );

      const result = attemptStep.result;

      if (result.isOk()) return result.value;

      const error = result.error;
      const retryCause = UnhandledException.is(error) ? error.cause : error;

      const canRetry =
        !attemptStep.aborted && attempt < policy.maxAttempts && policy.shouldRetry(retryCause);

      if (!canRetry) return yield* Result.err(error);

      let delayMs: number;
      try {
        delayMs = policy.getDelay(attempt - 1, retryCause);
      } catch (cause) {
        return yield* Result.err(new UnhandledException({ cause }));
      }

      if (delayMs > 0) {
        const delayAborted: boolean = yield* new SuspendInstruction((context) =>
          abortableDelay(delayMs, context.signal).then(() => context.signal.aborted),
        );

        if (delayAborted) return yield* result;
      }

      attempt += 1;
    }
  });
}

export function timeoutPlan<T, E, M>(
  source: Plan<T, E, M>,
  timeoutMs: number,
): Plan<T, E | TimeoutError, M> {
  return createPlan(function* () {
    try {
      validateTimeoutMs(timeoutMs);
    } catch (cause) {
      return yield* Result.err(new UnhandledException({ cause }));
    }

    const result: Result<T, E | UnhandledException | TimeoutError> = yield* new SuspendInstruction(
      (outerContext) =>
        raceTimeout(
          (context) => executePlanInterruptOnAbort(source, context),
          timeoutMs,
          outerContext,
        ),
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

export function cancelPlan<T, E, M>(
  source: Plan<T, E, M>,
  abortSignal: AbortSignal,
): Plan<T, E, M> {
  return createPlan(function* () {
    const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
      (outerContext) =>
        runWithBoundSignal(
          (mergedContext) => source.execute(mergedContext),
          abortSignal,
          outerContext,
        ),
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

export function retryRewriter(policy?: NormalizedRetryPolicy): PlanRewriter {
  const retryPolicy = policy ?? normalizeRetryPolicy();
  return createDelegatingRewriter((source) => retryPlan(source, retryPolicy));
}

export function timeoutRewriter(timeoutMs: number): PlanRewriter {
  return createDelegatingRewriter((source) => timeoutPlan(source, timeoutMs));
}

export function cancelRewriter(abortSignal: AbortSignal): PlanRewriter {
  return createDelegatingRewriter((source) => cancelPlan(source, abortSignal));
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  try {
    return await sleepWithSignal(ms, signal);
  } catch {
    // intentionally ignored
  }
}

async function runWithBoundSignal<T, E>(
  run: (context: RunContext<readonly unknown[]>) => PromiseLike<Result<T, E>>,
  boundSignal: AbortSignal,
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E>> {
  const controller = new AbortController();
  const runContext = createRunContext(
    controller.signal,
    outerContext.args,
    outerContext.extensions,
  );

  const forwardBoundAbort = () => controller.abort(boundSignal.reason);
  if (boundSignal.aborted) forwardBoundAbort();
  else boundSignal.addEventListener("abort", forwardBoundAbort, { once: true });

  const forwardOuterAbort = () => controller.abort(outerContext.signal.reason);
  if (outerContext.signal.aborted) forwardOuterAbort();
  else outerContext.signal.addEventListener("abort", forwardOuterAbort, { once: true });

  let result: Result<T, E> | undefined;
  try {
    result = await run(runContext);
  } finally {
    boundSignal.removeEventListener("abort", forwardBoundAbort);
    outerContext.signal.removeEventListener("abort", forwardOuterAbort);
  }

  return result;
}

async function raceTimeout<T, E>(
  run: (context: RunContext<readonly unknown[]>) => PromiseLike<Result<T, E>>,
  timeoutMs: number,
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | TimeoutError>> {
  const controller = new AbortController();
  const runContext = createRunContext(
    controller.signal,
    outerContext.args,
    outerContext.extensions,
  );
  const cascade = () => controller.abort(outerContext.signal.reason);

  if (outerContext.signal.aborted) cascade();
  else outerContext.signal.addEventListener("abort", cascade, { once: true });

  const runPromise = run(runContext);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: TimeoutError | undefined;
  const timeout = new Promise<Result<T, E | TimeoutError>>((resolve) => {
    timeoutId = setTimeout(() => {
      timeoutError = new TimeoutError({ timeoutMs });
      controller.abort(timeoutError);
      resolve(Result.err(timeoutError));
    }, timeoutMs);
  });

  const firstResult = await Promise.race([runPromise, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    outerContext.signal.removeEventListener("abort", cascade);
  });

  if (timeoutError === undefined) {
    return firstResult;
  }

  await runPromise;
  return Result.err(timeoutError);
}
