import { unsafeCoerce } from "./shared.js";
import { type EmptyMeta, type OpInterface, type SetBlockingMeta } from "./core/types.js";
import type { Tagged } from "./tagged.js";

type OpType<T, E, A extends readonly unknown[], M> = OpInterface<T, E, A, M> & Tagged<"Op">;

/** An operation that is not ready for top-level `.run()`. */
export type BlockingOp<
  T,
  E,
  A extends readonly unknown[],
  M = EmptyMeta,
  K extends PropertyKey = string,
  P = true,
> = OpType<T, E, A, SetBlockingMeta<M, K, P>>;

/**
 * Marks an operation as needing extension-specific preconditions before
 * top-level `.run()` by placing `Blocking<P>` on a metadata key.
 */
export function withBlocking<
  T,
  E,
  A extends readonly unknown[],
  M,
  const K extends PropertyKey,
  P = true,
>(op: OpType<T, E, A, M>, _key: K): BlockingOp<T, E, A, M, K, P> {
  // SAFETY: type-only metadata transition; runtime op behavior is unchanged.
  return unsafeCoerce(op);
}
