/**
 * Driver-level abort mechanics for suspended work and nested plan execution.
 *
 * Contributor call sites declare intent through `Settlement` in `settlement.ts`.
 * Suspend work wrapped with {@link withAbortDrain} maps to
 * {@link AbortSettlement.interruptAndDrainOnAbort} when the enclosing suspend uses
 * {@link AbortSettlement.interruptOnAbort} (see {@link settlementForSuspendedWork}).
 */

export type AbortSettlement =
  | { readonly kind: "passThrough" }
  | { readonly kind: "rejectOnAbort"; readonly getAbortReason: () => unknown }
  | { readonly kind: "interruptOnAbort"; readonly getAbortReason: () => unknown }
  | { readonly kind: "interruptAndDrainOnAbort"; readonly getAbortReason: () => unknown };

export const AbortSettlement = {
  passThrough: { kind: "passThrough" } as const satisfies AbortSettlement,

  rejectOnAbort(getAbortReason: () => unknown): AbortSettlement {
    return { kind: "rejectOnAbort", getAbortReason };
  },

  interruptOnAbort(getAbortReason: () => unknown): AbortSettlement {
    return { kind: "interruptOnAbort", getAbortReason };
  },

  interruptAndDrainOnAbort(getAbortReason: () => unknown): AbortSettlement {
    return { kind: "interruptAndDrainOnAbort", getAbortReason };
  },
};

const ABORT_DRAINED_WORK = Symbol("prodkit.op.abort-drained-work");

type AbortDrainedWork<T> = {
  readonly [ABORT_DRAINED_WORK]: true;
  readonly promise: PromiseLike<T>;
};

/** Suspend callback return type: plain promise or drain-on-abort wrapped work. */
export type SuspendWork<T> = PromiseLike<T> | AbortDrainedWork<T>;

export function withAbortDrain<T>(promise: PromiseLike<T>): AbortDrainedWork<T> {
  return { [ABORT_DRAINED_WORK]: true, promise };
}

export function isAbortDrainedWork<T>(work: SuspendWork<T>): work is AbortDrainedWork<T> {
  return typeof work === "object" && work !== null && ABORT_DRAINED_WORK in work;
}

export function settlementForSuspendedWork(
  driveSettlement: AbortSettlement,
  suspendWork: SuspendWork<unknown>,
): {
  readonly settlement: AbortSettlement;
  readonly suspended: PromiseLike<unknown>;
} {
  const shouldDrainOnAbort = isAbortDrainedWork(suspendWork);
  const settlement =
    driveSettlement.kind === "interruptOnAbort" && shouldDrainOnAbort
      ? AbortSettlement.interruptAndDrainOnAbort(driveSettlement.getAbortReason)
      : driveSettlement;
  const suspended = shouldDrainOnAbort ? suspendWork.promise : suspendWork;
  return { settlement, suspended };
}

function scheduleInterruptFallback(abortReason: unknown): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(abortReason), 0);
  });
}

/** Race in-flight work against a macrotimer fallback after the cooperative interrupt window. */
export function raceInFlightAfterInterrupt<T>(
  inFlight: PromiseLike<T>,
  abortReason: unknown,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queueMicrotask(() => {
      void Promise.race([inFlight, scheduleInterruptFallback(abortReason)]).then(resolve, reject);
    });
  });
}

export function awaitWithAbort<T>(
  suspended: PromiseLike<T>,
  signal: AbortSignal,
  settlement: AbortSettlement,
): PromiseLike<T> {
  if (settlement.kind === "passThrough") return suspended;

  if (signal.aborted) {
    return Promise.reject(settlement.getAbortReason());
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
      if (settlement.kind === "rejectOnAbort") {
        settleReject(settlement.getAbortReason());
        return;
      }

      void raceInFlightAfterInterrupt(suspended, settlement.getAbortReason()).then(
        settleResolve,
        settleReject,
      );
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
