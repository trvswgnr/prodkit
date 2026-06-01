/**
 * Cancellation settlement for suspend resume, Policy.cancel, DI lazy resolve, and combinator drain.
 *
 * Call sites declare settlement intent here instead of threading booleans through the driver.
 */

import { SuspendResume } from "./instructions.js";

export type CancelSettlement =
  | { readonly kind: "passThrough" }
  | { readonly kind: "rejectOnAbort"; readonly getAbortReason: () => unknown }
  | {
      readonly kind: "interruptOnAbort";
      readonly getAbortReason: () => unknown;
      readonly drainAfterAbort?: boolean;
    };

export const CancelSettlement = {
  passThrough: { kind: "passThrough" } as const satisfies CancelSettlement,

  rejectOnAbort(getAbortReason: () => unknown): CancelSettlement {
    return { kind: "rejectOnAbort", getAbortReason };
  },

  interruptOnAbort(
    getAbortReason: () => unknown,
    options?: { drainAfterAbort?: boolean },
  ): CancelSettlement {
    if (options?.drainAfterAbort === true) {
      return { kind: "interruptOnAbort", getAbortReason, drainAfterAbort: true };
    }
    return { kind: "interruptOnAbort", getAbortReason };
  },
};

export function settlementForSuspendResume(
  driveSettlement: CancelSettlement,
  resume: SuspendResume,
): CancelSettlement {
  if (driveSettlement.kind !== "interruptOnAbort" || resume !== SuspendResume.drainAfterAbort) {
    return driveSettlement;
  }
  return { ...driveSettlement, drainAfterAbort: true };
}

export function signalAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Aborted");
}

export function awaitWithSettlement<T>(
  suspended: PromiseLike<T>,
  signal: AbortSignal,
  settlement: CancelSettlement,
): PromiseLike<T> {
  if (settlement.kind === "passThrough") return suspended;

  const getAbortReason = settlement.getAbortReason;
  const rejectImmediately = settlement.kind === "rejectOnAbort";

  if (signal.aborted) {
    return Promise.reject(getAbortReason());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settleResolve = (value: T) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(error);
    };

    const onAbort = () => {
      if (settled) return;
      if (rejectImmediately) {
        settleReject(getAbortReason());
        return;
      }

      queueMicrotask(() => {
        if (settled) return;
        void Promise.race([suspended, macrotimerAbortRejection(getAbortReason())]).then(
          settleResolve,
          settleReject,
        );
      });
    };

    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(suspended).then(settleResolve, settleReject);
  });
}

export async function drainInFlightWork(suspended: PromiseLike<unknown>): Promise<void> {
  try {
    await suspended;
  } catch {
    // ignore: abort rejection or child settlement errors while draining fan-out/provision work
  }
}

/** Macrotimer fallback when cooperative work never observes abort. */
export function macrotimerAbortRejection(abortReason: unknown): Promise<never> {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(abortReason), 0);
  });
}

/** Defer one microtask, then race promise vs fallback (Policy.cancel non-cooperative path). */
export function raceAfterAbortWithFallback<T>(
  suspended: PromiseLike<T>,
  fallback: () => PromiseLike<T>,
): Promise<T> {
  return new Promise<T>((resolve) => {
    queueMicrotask(() => {
      void Promise.race([suspended, fallback()]).then(resolve);
    });
  });
}

export type BoundAbortSession = {
  readonly childSignal: AbortSignal;
  readonly boundAbortPromise: Promise<void>;
  readonly isBoundAborted: () => boolean;
  readonly detach: () => void;
};

/** Compose bound and outer abort signals into one child execution signal. */
export function createBoundAbortSession(
  boundSignal: AbortSignal,
  outerSignal: AbortSignal,
): BoundAbortSession {
  const controller = new AbortController();

  let boundAborted = false;
  let notifyBoundAbort!: () => void;
  const boundAbortPromise = new Promise<void>((resolve) => {
    notifyBoundAbort = resolve;
  });

  const onBoundAbort = () => {
    if (boundAborted) return;
    boundAborted = true;
    controller.abort(boundSignal.reason);
    notifyBoundAbort();
  };

  const onOuterAbort = () => controller.abort(outerSignal.reason);

  if (boundSignal.aborted) onBoundAbort();
  else boundSignal.addEventListener("abort", onBoundAbort);

  if (outerSignal.aborted) onOuterAbort();
  else outerSignal.addEventListener("abort", onOuterAbort, { once: true });

  return {
    childSignal: controller.signal,
    boundAbortPromise,
    isBoundAborted: () => boundAborted,
    detach: () => {
      boundSignal.removeEventListener("abort", onBoundAbort);
      outerSignal.removeEventListener("abort", onOuterAbort);
    },
  };
}

/**
 * Policy.cancel settlement after bound abort is observed:
 * cooperative child wins after microtask defer; non-cooperative child loses to macrotimer fallback.
 */
export function settleAfterBoundAbort<T>(
  runPromise: PromiseLike<T>,
  fallback: () => PromiseLike<T>,
): Promise<T> {
  return raceAfterAbortWithFallback(runPromise, fallback);
}

/** Race child execution against bound abort, then settle with cooperative or fallback semantics. */
export async function raceBoundCancelExecution<T>(
  runPromise: PromiseLike<T>,
  session: BoundAbortSession,
  fallback: () => PromiseLike<T>,
): Promise<T> {
  try {
    await Promise.race([runPromise, session.boundAbortPromise]);
    if (!session.isBoundAborted()) {
      return await runPromise;
    }
    return await settleAfterBoundAbort(runPromise, fallback);
  } finally {
    session.detach();
  }
}

export function interruptDriveSettlement(signal: AbortSignal): CancelSettlement {
  return CancelSettlement.interruptOnAbort(() => signalAbortReason(signal));
}

export function rejectOnAbortSettlement(signal: AbortSignal): CancelSettlement {
  return CancelSettlement.rejectOnAbort(() => signalAbortReason(signal));
}
