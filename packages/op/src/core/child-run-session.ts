import { abortReason } from "@prodkit/shared/runtime";
import { createRunContext, type RunContext } from "./runtime.js";

type Detachable = { detach(): void };

function watchParentAbort(parent: AbortSignal, onAbort: (reason: unknown) => void): Detachable {
  const cascade = () => onAbort(abortReason(parent));

  if (parent.aborted) cascade();
  else parent.addEventListener("abort", cascade, { once: true });

  return {
    detach() {
      parent.removeEventListener("abort", cascade);
    },
  };
}

type ChildContextSlot = {
  readonly signal: AbortSignal;
  readonly controller: AbortController;
  context(parent: RunContext<readonly unknown[]>): RunContext<readonly unknown[]>;
};

function childContextSlot(controller: AbortController): ChildContextSlot {
  return {
    signal: controller.signal,
    controller,
    context(parent) {
      return createRunContext(controller.signal, parent.args, parent.extensions);
    },
  };
}

export type IsolatedChildRunSession = {
  readonly signal: AbortSignal;
  context(): RunContext<readonly unknown[]>;
  abort(reason?: unknown): void;
  detach(): void;
};

function isolated(parent: RunContext<readonly unknown[]>): IsolatedChildRunSession {
  const controller = new AbortController();
  const slot = childContextSlot(controller);
  const watch = watchParentAbort(parent.signal, (reason) => controller.abort(reason));

  return {
    signal: slot.signal,
    context() {
      return slot.context(parent);
    },
    abort(reason) {
      controller.abort(reason);
    },
    detach() {
      watch.detach();
    },
  };
}

export type PoolChildSpawn = {
  readonly signal: AbortSignal;
  readonly controller: AbortController;
  context(): RunContext<readonly unknown[]>;
  release(): void;
};

export type PoolChildRunSession = {
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
      const slot = childContextSlot(controller);
      return {
        signal: slot.signal,
        controller: slot.controller,
        context() {
          return slot.context(parent);
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

export type BoundCancelChildRunSession = {
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

  const onOuterAbort = () => controller.abort(abortReason(parent.signal));

  if (boundSignal.aborted) onBoundAbort();
  else boundSignal.addEventListener("abort", onBoundAbort, { once: true });

  if (parent.signal.aborted) onOuterAbort();
  else parent.signal.addEventListener("abort", onOuterAbort, { once: true });

  return {
    signal: controller.signal,
    boundAbort,
    context() {
      return createRunContext(controller.signal, parent.args, parent.extensions);
    },
    detach() {
      boundSignal.removeEventListener("abort", onBoundAbort);
      parent.signal.removeEventListener("abort", onOuterAbort);
    },
  };
}

/** Contributor-only child AbortSignal sessions derived from a parent run context. */
export const ChildRunSession = {
  isolated,
  pool,
  boundCancel,
} as const;
