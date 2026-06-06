import type { Op } from "../index.js";
import type { OpIterable } from "./surface.js";
import { hasBrand } from "@prodkit/shared/runtime";

export const EMPTY_TUPLE: [] = [];
export const OP_BRAND: unique symbol = Symbol("prodkit.op");
export const OP_BOUND_BRAND: unique symbol = Symbol("prodkit.op.bound");

export function isOp(value: unknown): value is Op<unknown, unknown, readonly unknown[], unknown> {
  return hasBrand(value, OP_BRAND);
}

export function isIterableOp(
  value: unknown,
): value is Op<unknown, unknown, [], unknown> & OpIterable<unknown, unknown, unknown> {
  return isOp(value) && Symbol.iterator in value && typeof value[Symbol.iterator] === "function";
}

export function coerceToNullaryOp(value: unknown): Op<unknown, unknown, [], unknown> | undefined {
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
