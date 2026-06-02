import type { Result } from "../../src/result.js";

export function neverSettling(): Promise<never> {
  return new Promise<never>(() => {});
}

export async function settleOutcome(
  run: Promise<unknown>,
  withinMs = 50,
): Promise<"settled" | "timeout"> {
  return Promise.race([
    run.then(() => "settled" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), withinMs)),
  ]);
}

export function resolveAfter<T>(value: T, ms: number) {
  return new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
}

export function rejectAfter(reason: unknown, ms: number) {
  return new Promise<never>((_, reject) => setTimeout(() => reject(reason), ms));
}

export function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

export function trackAbortListeners(signal: AbortSignal) {
  type AbortListener = Parameters<AbortSignal["addEventListener"]>[1];
  type Registration = { listener: AbortListener; once: boolean };

  const registrations: Registration[] = [];
  const originalAdd: AbortSignal["addEventListener"] = signal.addEventListener.bind(signal);
  const originalRemove: AbortSignal["removeEventListener"] =
    signal.removeEventListener.bind(signal);

  const patchedAdd: AbortSignal["addEventListener"] = (type, listener, options) => {
    if (type === "abort") {
      const once = typeof options === "object" && options !== null ? options.once === true : false;
      registrations.push({ listener, once });
    }

    return originalAdd(type, listener, options);
  };

  const patchedRemove: AbortSignal["removeEventListener"] = (type, listener) => {
    if (type === "abort") {
      const idx = registrations.findIndex((registration) => registration.listener === listener);
      if (idx >= 0) registrations.splice(idx, 1);
    }

    return originalRemove(type, listener);
  };

  Object.assign(signal, {
    addEventListener: patchedAdd,
    removeEventListener: patchedRemove,
  });

  const clearOnceRegistrations: AbortListener = () => {
    for (let i = registrations.length - 1; i >= 0; i -= 1) {
      if (registrations[i]?.once) registrations.splice(i, 1);
    }
  };

  originalAdd("abort", clearOnceRegistrations);

  return {
    get activeAbortListeners() {
      return registrations.length;
    },
    restore() {
      Object.assign(signal, {
        addEventListener: originalAdd,
        removeEventListener: originalRemove,
      });
      originalRemove("abort", clearOnceRegistrations);
    },
  };
}

export const invalidConcurrencies = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY];

export const TRUE: boolean = true;

interface Runnable<T, E> {
  run: () => Promise<Result<T, E>>;
}

export async function expectRunEq<T1, E1, T2, E2>(a: Runnable<T1, E1>, b: Runnable<T2, E2>) {
  const { expect } = await import("vitest");
  const left = await a.run();
  const right = await b.run();
  if (left.isOk() && right.isOk()) {
    return expect(left.value).toEqual(right.value);
  }
  if (left.isErr() && right.isErr()) {
    return expect(left.error).toEqual(right.error);
  }
  throw new Error(`expected both Ok or both Err, got ${left.status} and ${right.status}`);
}

export const FC_ASSERT_OPTIONS = { numRuns: 1000 };
