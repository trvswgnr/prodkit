import { TimeoutError, UnhandledException } from "../../errors.js";
import { Result } from "../../result.js";
import { sleepWithSignal } from "../../shared.js";
import { SuspendInstruction } from "../instructions.js";
import { createRunContext } from "../runtime.js";
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from "../retry-policy.js";
import type { RunContext } from "../types.js";
import { createPlan, executePlanInterruptOnAbort, type Plan } from "./base.js";

export function retryPlan<T, E, M>(
  source: Plan<T, E, M>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Plan<T, E, M> {
  return createPlan(function* () {
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

      const delayMs = Math.max(0, policy.getDelay(attempt, retryCause));
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
  const clampedTimeoutMs = Math.max(0, timeoutMs);

  return createPlan(function* () {
    const result: Result<T, E | UnhandledException | TimeoutError> = yield* new SuspendInstruction(
      (outerContext) =>
        raceTimeout(
          (context) => executePlanInterruptOnAbort(source, context),
          clampedTimeoutMs,
          outerContext,
        ),
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

export function signalPlan<T, E, M>(source: Plan<T, E, M>, signal: AbortSignal): Plan<T, E, M> {
  return createPlan(function* () {
    const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
      (outerContext) =>
        runWithBoundSignal((mergedContext) => source.execute(mergedContext), signal, outerContext),
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return sleepWithSignal(ms, signal).catch(() => {});
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
