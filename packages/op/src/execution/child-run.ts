import { abortReason } from "@prodkit/shared/runtime";
import {
  CLEANUP_FAILURE_MESSAGE,
  ErrorGroup,
  TimeoutError,
  UnhandledException,
} from "../errors.js";
import { Result } from "../result.js";
import { createRunContext, type RunContext } from "./runtime.js";

function watchParentAbort(
  parent: AbortSignal,
  onAbort: (reason: unknown) => void,
): { detach(): void } {
  const cascade = () => onAbort(abortReason(parent));

  if (parent.aborted) cascade();
  else parent.addEventListener("abort", cascade, { once: true });

  return {
    detach() {
      parent.removeEventListener("abort", cascade);
    },
  };
}

type IsolatedChild = {
  readonly context: RunContext<readonly unknown[]>;
  abort(reason?: unknown): void;
  detach(): void;
};

function createIsolatedChild(parent: RunContext<readonly unknown[]>): IsolatedChild {
  const controller = new AbortController();
  const watch = watchParentAbort(parent.signal, (reason) => controller.abort(reason));

  return {
    context: createRunContext(controller.signal, parent.args, parent.extensions),
    abort(reason) {
      controller.abort(reason);
    },
    detach() {
      watch.detach();
    },
  };
}

type FanOutChild = {
  readonly context: RunContext<readonly unknown[]>;
  abort(reason?: unknown): void;
  release(): void;
};

type FanOutChildren = {
  spawn(): FanOutChild;
  abortActive(reason?: unknown): void;
  detach(): void;
};

export function createFanOutChildren(parent: RunContext<readonly unknown[]>): FanOutChildren {
  const active = new Set<AbortController>();
  const watch = watchParentAbort(parent.signal, (reason) => {
    for (const controller of active) controller.abort(reason);
  });

  return {
    spawn() {
      const controller = new AbortController();
      active.add(controller);
      if (parent.signal.aborted) controller.abort(abortReason(parent.signal));
      return {
        context: createRunContext(controller.signal, parent.args, parent.extensions),
        abort(reason) {
          controller.abort(reason);
        },
        release() {
          active.delete(controller);
        },
      };
    },
    abortActive(reason) {
      for (const controller of active) controller.abort(reason);
    },
    detach() {
      watch.detach();
    },
  };
}

type BoundCancelChild = {
  readonly context: RunContext<readonly unknown[]>;
  detach(): void;
};

function normalizeCleanupFailureAfterInterruption<T, E>(
  drainedResult: Result<T, E>,
  interruption: unknown,
  unrelatedFailure: "prependInterruption" | "preserve",
): Result<T, E | UnhandledException> | undefined {
  if (drainedResult.isOk()) return undefined;

  const error = drainedResult.error;
  if (
    !UnhandledException.is(error) ||
    !ErrorGroup.is(error.cause) ||
    error.cause.message !== CLEANUP_FAILURE_MESSAGE
  ) {
    return undefined;
  }

  const { errors } = error.cause;
  if (errors.length === 0) return undefined;

  const [first, ...rest] = errors;
  const isInterruption =
    first === interruption || (UnhandledException.is(first) && first.cause === interruption);
  if (!isInterruption && unrelatedFailure === "preserve") return undefined;
  const preservedErrors = isInterruption ? [interruption, ...rest] : [interruption, ...errors];

  return Result.err(
    new UnhandledException({
      cause: new ErrorGroup(preservedErrors, error.cause.message),
    }),
  );
}

function createBoundCancelChild(
  boundSignal: AbortSignal,
  parent: RunContext<readonly unknown[]>,
): BoundCancelChild {
  const controller = new AbortController();

  const onBoundAbort = () => {
    controller.abort(abortReason(boundSignal));
  };

  const outerWatch = watchParentAbort(parent.signal, (reason) => controller.abort(reason));

  if (boundSignal.aborted) onBoundAbort();
  else boundSignal.addEventListener("abort", onBoundAbort, { once: true });

  return {
    context: createRunContext(controller.signal, parent.args, parent.extensions),
    detach() {
      boundSignal.removeEventListener("abort", onBoundAbort);
      outerWatch.detach();
    },
  };
}

export async function runWithBoundCancel<T, E>(
  run: (context: RunContext<readonly unknown[]>) => Promise<Result<T, E | UnhandledException>>,
  boundSignal: AbortSignal,
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>> {
  if (boundSignal.aborted) {
    return Result.err(new UnhandledException({ cause: abortReason(boundSignal) }));
  }

  const child = createBoundCancelChild(boundSignal, outerContext);
  try {
    const result = await run(child.context);
    if (!boundSignal.aborted) return result;

    const interruption = abortReason(boundSignal);
    return normalizeCleanupFailureAfterInterruption(result, interruption, "preserve") ?? result;
  } finally {
    child.detach();
  }
}

export async function runWithTimeout<T, E>(
  run: (context: RunContext<readonly unknown[]>) => PromiseLike<Result<T, E>>,
  timeoutMs: number,
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | TimeoutError | UnhandledException>> {
  const child = createIsolatedChild(outerContext);
  const runPromise = run(child.context);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: TimeoutError | undefined;
  const timeout = new Promise<Result<T, E | TimeoutError>>((resolve) => {
    timeoutId = setTimeout(() => {
      timeoutError = new TimeoutError({ timeoutMs });
      child.abort(timeoutError);
      resolve(Result.err(timeoutError));
    }, timeoutMs);
  });

  const firstResult = await Promise.race([runPromise, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    child.detach();
  });

  if (timeoutError === undefined) {
    return firstResult;
  }

  const drainedResult = await runPromise;
  return (
    normalizeCleanupFailureAfterInterruption(drainedResult, timeoutError, "prependInterruption") ??
    Result.err(timeoutError)
  );
}
