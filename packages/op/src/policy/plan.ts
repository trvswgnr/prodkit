import { TimeoutError, UnhandledException } from "../errors.js";
import { createBoundAbortSession, raceBoundCancelExecution } from "../core/cancel-session.js";
import { Result } from "../result.js";
import { sleepWithSignal } from "../shared.js";
import {
  RegisterExitFinalizerInstruction,
  SuspendInstruction,
  SuspendResume,
} from "../core/instructions.js";
import { createRunContext } from "../core/runtime.js";
import { normalizeRetryPolicy, type NormalizedRetryPolicy } from "./retry-policy.js";
import { validateTimeoutMs } from "./validate.js";
import type { EnterFn, ExitFn, ReleaseFn } from "../core/plan/context.js";
import type { TrackedErr } from "../core/plan/surface.js";
import type { RunContext } from "../core/runtime.js";
import {
  createPlan,
  executePlanInterruptOnAbort,
  type Plan,
  type PlanRewriter,
} from "../core/plan/base.js";
import { onEnterPlan, onExitPlan } from "../core/plan/lifecycle.js";
import { mapErrPlan, mapPlan, recoverPlan, tapErrPlan, tapPlan } from "../core/plan/transforms.js";
import { allPlan, allSettledPlan, anyPlan, racePlan } from "../core/plan/combinators.js";

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

  all<T, E, M>(
    source: readonly Plan<T, E, M>[],
    concurrency?: number,
  ): Plan<unknown, unknown, unknown> {
    return allPlan(
      source.map((child) => child.rewrite<T, E, M>(this)),
      concurrency,
    );
  }

  race<T, E, M>(source: readonly Plan<T, E, M>[]): Plan<unknown, unknown, unknown> {
    return racePlan(source.map((child) => child.rewrite<T, E, M>(this)));
  }

  any<T, E, M>(source: readonly Plan<T, E, M>[]): Plan<unknown, unknown, unknown> {
    return anyPlan(source.map((child) => child.rewrite<T, E, M>(this)));
  }

  allSettled<T, E, M>(
    source: readonly Plan<T, E, M>[],
    concurrency?: number,
  ): Plan<unknown, unknown, unknown> {
    return allSettledPlan(
      source.map((child) => child.rewrite<T, E, M>(this)),
      concurrency,
    );
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
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (context) => source.execute(context),
        SuspendResume.passThrough,
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

function retryPlan<T, E, M>(
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
      const attemptStep: AttemptStep = yield* new SuspendInstruction(
        (context) =>
          source.execute(context).then((result) => ({ result, aborted: context.signal.aborted })),
        SuspendResume.passThrough,
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
        const delayAborted: boolean = yield* new SuspendInstruction(
          (context) => abortableDelay(delayMs, context.signal).then(() => context.signal.aborted),
          SuspendResume.passThrough,
        );

        if (delayAborted) return yield* result;
      }

      attempt += 1;
    }
  });
}

function timeoutPlan<T, E, M>(
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
      SuspendResume.passThrough,
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

function cancelPlan<T, E, M>(source: Plan<T, E, M>, abortSignal: AbortSignal): Plan<T, E, M> {
  return createPlan(function* () {
    const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
      (outerContext) => raceBoundCancel(source, abortSignal, outerContext),
      SuspendResume.drainAfterAbort,
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

function nonCooperativeCancelFallback<T, E>(
  abortReason: unknown,
): Promise<Result<T, E | UnhandledException>> {
  // schedule on demand after bound abort, not when Policy.cancel is entered
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(Result.err(new UnhandledException({ cause: abortReason })));
    }, 0);
  });
}

function raceBoundCancel<T, E, M>(
  source: Plan<T, E, M>,
  boundSignal: AbortSignal,
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>> {
  const session = createBoundAbortSession(boundSignal, outerContext.signal);
  const runContext = createRunContext(
    session.childSignal,
    outerContext.args,
    outerContext.extensions,
  );
  const runPromise = source.execute(runContext);

  return raceBoundCancelExecution(runPromise, session, () =>
    nonCooperativeCancelFallback(boundSignal.reason),
  );
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
