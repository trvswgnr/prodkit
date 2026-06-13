import { abortReason } from "@prodkit/shared/runtime";
import { TimeoutError, UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { raceInFlightAfterInterrupt } from "./settlement.js";
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

type IsolatedChildRunSession = {
  readonly signal: AbortSignal;
  context(): RunContext<readonly unknown[]>;
  abort(reason?: unknown): void;
  detach(): void;
};

function isolated(parent: RunContext<readonly unknown[]>): IsolatedChildRunSession {
  const controller = new AbortController();
  const watch = watchParentAbort(parent.signal, (reason) => controller.abort(reason));

  return {
    signal: controller.signal,
    context() {
      return createRunContext(controller.signal, parent.args, parent.extensions);
    },
    abort(reason) {
      controller.abort(reason);
    },
    detach() {
      watch.detach();
    },
  };
}

type PoolChildSpawn = {
  readonly signal: AbortSignal;
  readonly controller: AbortController;
  context(): RunContext<readonly unknown[]>;
  release(): void;
};

type PoolChildRunSession = {
  spawn(): PoolChildSpawn;
  activeControllers(): ReadonlySet<AbortController>;
  detach(): void;
};

function pool(parent: RunContext<readonly unknown[]>): PoolChildRunSession {
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
        signal: controller.signal,
        controller,
        context() {
          return createRunContext(controller.signal, parent.args, parent.extensions);
        },
        release() {
          active.delete(controller);
        },
      };
    },
    activeControllers() {
      return active;
    },
    detach() {
      watch.detach();
    },
  };
}

type BoundCancelChildRunSession = {
  readonly signal: AbortSignal;
  readonly boundAbort: Promise<void>;
  context(): RunContext<readonly unknown[]>;
  detach(): void;
};

function boundCancel(
  boundSignal: AbortSignal,
  parent: RunContext<readonly unknown[]>,
): BoundCancelChildRunSession {
  const controller = new AbortController();

  let boundAborted = false;
  let notifyBoundAbort!: () => void;
  const boundAbort = new Promise<void>((resolve) => {
    notifyBoundAbort = resolve;
  });

  const onBoundAbort = () => {
    if (boundAborted) return;
    boundAborted = true;
    controller.abort(boundSignal.reason);
    notifyBoundAbort();
  };

  const outerWatch = watchParentAbort(parent.signal, (reason) => controller.abort(reason));

  if (boundSignal.aborted) onBoundAbort();
  else boundSignal.addEventListener("abort", onBoundAbort, { once: true });

  return {
    signal: controller.signal,
    boundAbort,
    context() {
      return createRunContext(controller.signal, parent.args, parent.extensions);
    },
    detach() {
      boundSignal.removeEventListener("abort", onBoundAbort);
      outerWatch.detach();
    },
  };
}

function raceBoundCancel<T, E>(
  run: (context: RunContext<readonly unknown[]>) => Promise<Result<T, E | UnhandledException>>,
  boundSignal: AbortSignal,
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>> {
  const session = boundCancel(boundSignal, outerContext);
  const runPromise = run(session.context());
  const firstSettlement = Promise.race([
    runPromise.then(() => "run" as const),
    session.boundAbort.then(() => "boundAbort" as const),
  ]);

  return firstSettlement
    .then((winner) => {
      if (winner === "run") return runPromise;

      return raceInFlightAfterInterrupt(runPromise, boundSignal.reason).catch((reason) =>
        Result.err(new UnhandledException({ cause: reason })),
      );
    })
    .finally(session.detach);
}

async function raceTimeout<T, E>(
  run: (context: RunContext<readonly unknown[]>) => PromiseLike<Result<T, E>>,
  timeoutMs: number,
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | TimeoutError>> {
  const session = isolated(outerContext);
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

/** Contributor-only child AbortSignal sessions derived from a parent run context. */
export const ChildRunSession = {
  isolated,
  pool,
  boundCancel,
  raceBoundCancel,
  raceTimeout,
} as const;
