import type { Instruction } from "./core/types.js";
import type { Op } from "./index.js";

export const EMPTY_ARGS: [] = [];

export const NULLARY_OP_SYMBOL = Symbol("NullaryOp");

/**
 * UNSAFE: casts any value to a given type
 *
 * @warning This function is UNSAFE and should be used only when the type is known to be correct
 * Every call site for this function should be accompanied by a comment explaining why it is
 * absolutely necessary.
 */
export function cast<T>(value: unknown): T {
  return value as T;
}

export function isOp(value: unknown): value is Op<unknown, unknown, readonly unknown[]> {
  return typeof value === "function" && "_tag" in value && value._tag === "Op";
}

export function isNullaryOp(value: unknown): value is Op<unknown, unknown, []> {
  return (
    typeof value === "function" &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function" &&
    NULLARY_OP_SYMBOL in value
  );
}

export function coerceToNullaryOp(value: unknown): Op<unknown, unknown, []> | undefined {
  if (!isOp(value)) return undefined;
  if (isNullaryOp(value)) return value;
  return cast(value());
}

export function isAwaited<T>(value: T | Promise<T>): value is Awaited<T> {
  return !(value instanceof Promise);
}

export function isGeneratorObject(
  value: unknown,
): value is Generator<Instruction<unknown>, unknown, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (!("next" in value) || typeof value.next !== "function") return false;
  if (!("throw" in value) || typeof value.throw !== "function") return false;
  if (!(Symbol.iterator in value) || typeof value[Symbol.iterator] !== "function") return false;
  return true;
}
