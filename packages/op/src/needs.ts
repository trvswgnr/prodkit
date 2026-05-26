import { unsafeCoerce } from "./shared.js";
import { type EmptyMeta, type OpInterface, type SetNeedsNamespace } from "./core/types.js";
import type { Tagged } from "./tagged.js";

type OpType<T, E, A extends readonly unknown[], M> = OpInterface<T, E, A, M> & Tagged<"Op">;

/** An operation that is not ready for top-level `.run()`. */
export type NeedsOp<
  T,
  E,
  A extends readonly unknown[],
  M = EmptyMeta,
  NS extends string = string,
> = OpType<T, E, A, SetNeedsNamespace<M, NS>>;

/**
 * Marks an operation as needing extension-specific preconditions before
 * top-level `.run()`.
 */
export function Needs<T, E, A extends readonly unknown[], M, const NS extends string>(
  op: OpType<T, E, A, M>,
  _namespace: NS,
): NeedsOp<T, E, A, M, NS> {
  // SAFETY: type-only metadata transition; runtime op behavior is unchanged.
  return unsafeCoerce(op);
}
