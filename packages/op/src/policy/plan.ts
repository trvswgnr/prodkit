import { TimeoutError, UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { sleepWithSignal } from "@prodkit/shared/runtime";
import { SuspendInstruction, RegisterExitFinalizerInstruction } from "../execution/instructions.js";
import { ChildRunSession } from "../execution/child-run-session.js";
import { Settlement } from "../execution/settlement.js";
import { normalizeRetryPolicy, type NormalizedRetryPolicy } from "./retry-policy.js";
import { validateTimeoutMs } from "./validate.js";
import type { ReleaseFn } from "../core/lifecycle.js";
import { createPlan, createUnaryPlan, type Plan, type PlanRewriter } from "../plan/model.js";

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
        ChildRunSession.raceTimeout(
          (context) => Settlement.interrupting.runPlan(source, context),
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
    const result: Result<T, E | UnhandledException> =
      yield* Settlement.interruptingAndDraining.suspend((outerContext) =>
        ChildRunSession.raceBoundCancel(
          (context) => source.execute(context),
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
  return { apply: (source) => retryPlan(source, retryPolicy) };
}

export function timeoutRewriter(timeoutMs: number): PlanRewriter {
  return { apply: (source) => timeoutPlan(source, timeoutMs) };
}

export function cancelRewriter(abortSignal: AbortSignal): PlanRewriter {
  return { apply: (source) => cancelPlan(source, abortSignal) };
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  try {
    return await sleepWithSignal(ms, signal);
  } catch {
    // intentionally ignored
  }
}
