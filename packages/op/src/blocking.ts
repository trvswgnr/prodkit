import { unsafeCoerce } from "@prodkit/shared/runtime";
import { type EmptyMeta, type SetBlockingMeta } from "./core/meta.js";
import type { Op } from "./index.js";

/** An operation that is not ready for top-level `.run()`. */
export type BlockingOp<T, E, A, M = EmptyMeta, K extends PropertyKey = string, P = true> = Op<
  T,
  E,
  A,
  SetBlockingMeta<M, K, P>
>;

/**
 * Marks an operation as needing extension-specific preconditions before
 * top-level `.run()` by placing `Blocking<P>` on a metadata key.
 */
export function withBlocking<T, E, A, M, const K extends PropertyKey, P = true>(
  op: Op<T, E, A, M>,
  _key: K,
): BlockingOp<T, E, A, M, K, P> {
  // SAFETY: withBlocking only changes metadata phantom types; the runtime callable is the same op instance.
  return unsafeCoerce(op);
}
