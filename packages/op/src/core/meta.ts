// oxlint-disable typescript/no-explicit-any
declare const EMPTY_META: unique symbol;
declare const BLOCKING: unique symbol;

/**
 * Metadata merge algebra for composed operations.
 *
 * Operations carry extension metadata on `M`. When they compose (`flatMap`, combinators,
 * yielded custom instructions), {@link MergeMeta} accumulates requirements from both sides.
 *
 * {@link EmptyMeta} is the identity element: merging with empty metadata leaves the other
 * operand unchanged.
 *
 * Per-key merge outcomes:
 * - Keys present on only one side are kept as-is.
 * - Plain values at the same key union (requirements accumulate).
 * - When either side at a key is {@link Blocking}, the merged value is `Blocking` with
 *   payloads unioned. `Blocking` takes precedence over plain values at that key.
 *
 * {@link MergeMetaObjects} merges two object shapes key-by-key. {@link MergeUnionMeta} applies
 * the same rules when a generator yields multiple custom instructions. {@link CollectBlockingPayload}
 * extracts `Blocking` payload types during union merges so blocking requirements stay branded.
 */
type MergeBlockingValue<VA, VB> =
  VA extends Blocking<infer TA>
    ? VB extends Blocking<infer TB>
      ? Blocking<TA | TB>
      : Blocking<TA>
    : VB extends Blocking<infer TB>
      ? Blocking<TB>
      : VA | VB;

type MergeMetaValue<A, B, K extends PropertyKey> = K extends keyof StripEmpty<A> &
  keyof StripEmpty<B>
  ? MergeBlockingValue<StripEmpty<A>[K], StripEmpty<B>[K]>
  : K extends keyof StripEmpty<A>
    ? StripEmpty<A>[K]
    : K extends keyof StripEmpty<B>
      ? StripEmpty<B>[K]
      : never;

type MergeMetaObjects<A, B> = NormalizeMeta<{
  [K in keyof StripEmpty<A> | keyof StripEmpty<B>]: MergeMetaValue<A, B, K>;
}>;

type UnionMetaValueAt<U, K extends PropertyKey> = U extends Record<K, infer V> ? V : never;

type CollectBlockingPayload<U, K extends PropertyKey> =
  U extends Record<K, Blocking<infer R>> ? R : never;

type MergeUnionMetaValue<U, K extends PropertyKey> = [CollectBlockingPayload<U, K>] extends [never]
  ? UnionMetaValueAt<U, K>
  : Blocking<CollectBlockingPayload<U, K>>;

export type MergeUnionMeta<U> = NormalizeMeta<
  [U] extends [never]
    ? EmptyMeta
    : {
        [K in AllMetaKeys<U>]: MergeUnionMetaValue<U, K>;
      }
>;

/** Merges metadata accumulated across two composed operations. See merge algebra above. */
export type MergeMeta<A, B> =
  IsAny<A> extends true
    ? any
    : IsAny<B> extends true
      ? any
      : [A] extends [EmptyMeta]
        ? NormalizeMeta<B>
        : [B] extends [EmptyMeta]
          ? NormalizeMeta<A>
          : MergeMetaObjects<A, MergeMetaRight<B>>;

export type SetBlockingMeta<M, K extends PropertyKey, T> = NormalizeMeta<
  Simplify<StripEmpty<M> & { [P in K]: Blocking<T> }>
>;

/**
 * Runnable gating from metadata.
 *
 * Top-level {@link BaseOp.run} is available only when every metadata key is satisfied.
 * {@link HasBlocking} is true when any key still carries {@link Blocking} with a non-empty
 * payload. {@link IsRunnable} is false in that case, so `.run()` is not on the operation type.
 *
 * Extension packages block `.run()` by attaching `Blocking` to metadata keys (or via
 * `withBlocking(...)`). Callers satisfy those requirements through extension-specific runners
 * first; clearing or replacing blocking metadata is what makes `.run()` type-check again.
 */
export type IsRunnable<M> =
  IsAny<M> extends true ? true : [HasBlocking<M>] extends [true] ? false : true;

/** True when metadata still carries an unsatisfied {@link Blocking} requirement on any key. */
type HasBlocking<M> = keyof StripEmpty<M> extends never
  ? false
  : {
        [K in keyof StripEmpty<M>]: StripEmpty<M>[K] extends Blocking<infer R>
          ? [R] extends [never]
            ? false
            : true
          : false;
      }[keyof StripEmpty<M>] extends true
    ? true
    : false;

/**
 * Empty metadata; the merge identity element.
 *
 * Operations with no extension requirements use `EmptyMeta`. Merging with `EmptyMeta` leaves
 * the other operand unchanged in both directions.
 */
export type EmptyMeta = {
  readonly [EMPTY_META]: true;
};

/**
 * Branded metadata value that blocks top-level `.run()` until its payload is satisfied.
 *
 * During metadata merge, `Blocking` at a key takes precedence over plain values and unions
 * payloads with other `Blocking` values at the same key.
 */
export type Blocking<T> = { readonly [BLOCKING]: T };

type IsAny<T> = 0 extends 1 & T ? true : false;
export type NormalizeMeta<M> = [M] extends [never]
  ? EmptyMeta
  : M extends EmptyMeta
    ? EmptyMeta
    : M extends object
      ? keyof M extends never
        ? EmptyMeta
        : Simplify<M>
      : M;

export type StripEmpty<M> = [M] extends [never] ? {} : M extends EmptyMeta ? {} : M;
export type Simplify<T> = T extends object ? { [K in keyof T]: T[K] } : T;
type WithoutEmptyMeta<M> = M extends EmptyMeta ? never : M;
type MergeMetaRight<B> = [WithoutEmptyMeta<B>] extends [never] ? EmptyMeta : WithoutEmptyMeta<B>;
type AllMetaKeys<U> = U extends unknown ? keyof U : never;
