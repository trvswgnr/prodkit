/**
 * Abort settlement for suspend interruption, DI lazy resolve, and nested-plan drain.
 *
 * Call sites declare settlement intent here instead of threading booleans through the driver.
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

      queueMicrotask(() => {
        if (settled) return;
        const abortFallback = new Promise<never>((_, rejectAbort) => {
          setTimeout(() => rejectAbort(settlement.getAbortReason()), 0);
        });
        void Promise.race([suspended, abortFallback]).then(settleResolve, settleReject);
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
