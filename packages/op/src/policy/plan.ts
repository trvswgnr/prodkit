import { TimeoutError, UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { sleepWithSignal } from "@prodkit/shared/runtime";
import { SuspendInstruction, RegisterExitFinalizerInstruction } from "../core/instructions.js";
import { ChildRunSession } from "../core/child-run-session.js";
import { Settlement, SettlementPresets } from "../core/settlement-scope.js";
import { normalizeRetryPolicy, type NormalizedRetryPolicy } from "./retry-policy.js";
import { validateTimeoutMs } from "./validate.js";
import type { ReleaseFn } from "../core/plan/context.js";
import type { RunContext } from "../core/runtime.js";
import { createPlan, createUnaryPlan, type Plan, type PlanRewriter } from "../core/plan/base.js";

function policyRewriter(apply: PlanRewriter["apply"]): PlanRewriter {
  return { apply };
}

export function releasePlan<T, E, M>(source: Plan<T, E, M>, release: ReleaseFn<T>): Plan<T, E, M> {
  return createUnaryPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      if (result.isErr()) return yield* result;

      yield new RegisterExitFinalizerInstruction(
        () => Promise.resolve(release(result.value)).then(() => {}),
        undefined,
      );

      return result.value;
    },
    source,
    (inner) => releasePlan(inner, release),
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
          (context) => Settlement.interrupting(context.signal).runPlan(source, context),
          timeoutMs,
          outerContext,
        ),
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

function cancelPlan<T, E, M>(source: Plan<T, E, M>, abortSignal: AbortSignal): Plan<T, E, M> {
  return createPlan(function* () {
    const result: Result<T, E | UnhandledException> = yield* Settlement.suspendObservedWork(
      SettlementPresets.interruptingAndDraining,
      (outerContext) => raceBoundCancel(source, abortSignal, outerContext),
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

export function retryRewriter(policy?: NormalizedRetryPolicy): PlanRewriter {
  const retryPolicy = policy ?? normalizeRetryPolicy();
  return policyRewriter((source) => retryPlan(source, retryPolicy));
}

export function timeoutRewriter(timeoutMs: number): PlanRewriter {
  return policyRewriter((source) => timeoutPlan(source, timeoutMs));
}

export function cancelRewriter(abortSignal: AbortSignal): PlanRewriter {
  return policyRewriter((source) => cancelPlan(source, abortSignal));
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
  const session = ChildRunSession.boundCancel(boundSignal, outerContext);
  const runPromise = source.execute(session.context());
  const firstSettlement = Promise.race([
    runPromise.then(() => "run" as const),
    session.boundAbort.then(() => "boundAbort" as const),
  ]);

  return firstSettlement
    .then((winner) => {
      if (winner === "run") return runPromise;

      return new Promise<Result<T, E | UnhandledException>>((resolve, reject) => {
        queueMicrotask(() => {
          void Promise.race([
            runPromise,
            nonCooperativeCancelFallback<T, E>(boundSignal.reason),
          ]).then(resolve, reject);
        });
      });
    })
    .finally(session.detach);
}

async function raceTimeout<T, E>(
  run: (context: RunContext<readonly unknown[]>) => PromiseLike<Result<T, E>>,
  timeoutMs: number,
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | TimeoutError>> {
  const session = ChildRunSession.isolated(outerContext);
  const runPromise = run(session.context());
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: TimeoutError | undefined;
  const timeout = new Promise<Result<T, E | TimeoutError>>((resolve) => {
    timeoutId = setTimeout(() => {
      timeoutError = new TimeoutError({ timeoutMs });
      session.abort(timeoutError);
      resolve(Result.err(timeoutError));
    }, timeoutMs);
  });

  const firstResult = await Promise.race([runPromise, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    session.detach();
  });

  if (timeoutError === undefined) {
    return firstResult;
  }

  await runPromise;
  return Result.err(timeoutError);
}
