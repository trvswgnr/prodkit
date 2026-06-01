/**
 * Shared abort-race mechanics for DI lazy-resolve, policy cancel settlement, and (via #164)
 * driveIterator suspend resume.
 *
 * Call-site modes:
 * - `rejectImmediately`: DI inject async factory resolution (`di/internal.ts`)
 * - `cooperativeSettle`: driveIterator interrupt-on-abort suspend resume (`core/runtime.ts`, #164)
 * - `raceCooperativelyAfterAbort`: Policy.cancel bound-abort settlement after abort is observed
 *   (`policy/plan.ts`)
 */

export type AbortSignalRaceMode = "rejectImmediately" | "cooperativeSettle";

export type RaceAgainstAbortSignalOptions = {
  /**
   * rejectImmediately: reject with getAbortReason() as soon as the signal aborts.
   * cooperativeSettle: defer one microtask, then race suspended vs a macrotimer fallback so
   * cooperative children can settle first.
   */
  mode: AbortSignalRaceMode;
  getAbortReason: () => unknown;
};

export function raceAgainstAbortSignal<T>(
  suspended: PromiseLike<T>,
  signal: AbortSignal,
  options: RaceAgainstAbortSignalOptions,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(options.getAbortReason());
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
      if (options.mode === "rejectImmediately") {
        settleReject(options.getAbortReason());
        return;
      }

      queueMicrotask(() => {
        if (settled) return;
        const abortOnLaterMacrotask = new Promise<never>((_, abort) => {
          setTimeout(() => abort(options.getAbortReason()), 0);
        });
        void Promise.race([suspended, abortOnLaterMacrotask]).then(settleResolve, settleReject);
      });
    };

    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(suspended).then(settleResolve, settleReject);
  });
}

/** Defer one microtask, then race promise vs fallback (Policy.cancel non-cooperative path). */
export function raceCooperativelyAfterAbort<T>(
  suspended: PromiseLike<T>,
  fallback: () => PromiseLike<T>,
): Promise<T> {
  return new Promise<T>((resolve) => {
    queueMicrotask(() => {
      void Promise.race([suspended, fallback()]).then(resolve);
    });
  });
}
