/** Structural abort signal compatible with platform globals and userland stand-ins. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export function abortReason(signal: AbortSignalLike): unknown {
  return signal.reason ?? new Error("Aborted");
}

export function sleepWithSignal(ms: number, signal: AbortSignalLike): Promise<void> {
  if (!Number.isFinite(ms)) {
    return Promise.reject(new RangeError("sleep duration must be a finite number"));
  }

  const durationMs = Math.max(0, ms);
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * UNSAFE: casts any value to a given type
 *
 * @warning Use only when the type is known to be correct. Prefer a comment at each call site.
 */
export function unsafeCoerce<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions - only used here
  return value as T;
}

/** `never`-typed sentinel for phantom brand slots and unused instruction payloads. */
export const NEVER: never =
  // SAFETY: phantom meta slots need a never value; undefined is the sentinel and must not be read as data.
  unsafeCoerce<never>(undefined);

export function isRecordLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

/** True when `value` is record-like and `value[key] === expected`. */
export function keyIs<K extends PropertyKey, const V>(
  value: unknown,
  key: K,
  expected: V,
): value is Record<K, V> {
  return isRecordLike(value) && value[key] === expected;
}

export function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  if (value instanceof Promise) return true;

  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

export function isAwaited<T>(value: T | PromiseLike<T> | Awaited<T>): value is Awaited<T> {
  return !isPromiseLike(value);
}

export function identity<T>(value: T): T {
  return value;
}
