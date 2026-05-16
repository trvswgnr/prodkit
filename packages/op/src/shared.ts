import type { Op } from "./index.js";
import type { OpIterable } from "./core/types.js";

export const EMPTY_TUPLE: [] = [];
export const OP_BRAND: unique symbol = Symbol("prodkit.op");
export const OP_BOUND_BRAND: unique symbol = Symbol("prodkit.op.bound");

/**
 * Narrow `AbortSignal` / userland stand-ins across runtimes without depending on DOM `lib`s.
 *
 * Compatible with WHATWG-ish signals and `@prodkit`'s augmented globals in this package's types.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(
    type: "abort",
    /** Installations invoke this with zero args when the signal fires. */
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export function isRecordLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

/** True when `value` is a function that carries `key -> true` (internal brand pattern). */
export function hasBrand<K extends PropertyKey>(value: unknown, key: K): value is Record<K, true> {
  return isRecordLike(value) && value[key] === true;
}

/**
 * UNSAFE: casts any value to a given type
 *
 * @warning This function is UNSAFE and should be used only when the type is known to be correct
 * Every call site for this function should be accompanied by a comment explaining why it is
 * absolutely necessary.
 */
export function unsafeCoerce<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions - only used here
  return value as T;
}

/** `never`-typed sentinel for phantom brand slots and unused instruction payloads. */
export const NEVER: never =
  // SAFETY: centralized `never` sentinel; callers must treat this as proof-only at the type level.
  unsafeCoerce<never>(undefined);

export function isOp(value: unknown): value is Op<unknown, unknown, readonly unknown[]> {
  return hasBrand(value, OP_BRAND);
}

export function isIterableOp(
  value: unknown,
): value is Op<unknown, unknown, []> & OpIterable<unknown, unknown> {
  return isOp(value) && Symbol.iterator in value && typeof value[Symbol.iterator] === "function";
}

export function coerceToNullaryOp(value: unknown): Op<unknown, unknown, []> | undefined {
  if (
    !isOp(value) ||
    !(OP_BOUND_BRAND in value) ||
    value[OP_BOUND_BRAND] !== true ||
    typeof value !== "function"
  ) {
    return undefined;
  }
  const nullary = value();
  return isIterableOp(nullary) ? nullary : undefined;
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
