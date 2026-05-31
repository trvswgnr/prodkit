/** Symbol key for the argument tuple applied to an HKT instance. */
export const HKT_ARGS = Symbol("prodkit.hkt.args");

/** Symbol key for the result type produced by an HKT instance. */
export const HKT_RESULT = Symbol("prodkit.hkt.result");

interface HKTApplication<Args> {
  readonly [HKT_ARGS]: Args;
}

/**
 * Base interface for a higher-kinded type transform.
 * Declare `[HKT_ARGS]` and `[HKT_RESULT]` on the interface, then use {@link Apply} to instantiate.
 */
export interface HKT {
  readonly [HKT_ARGS]: unknown;
  readonly [HKT_RESULT]: unknown;
}

/** Reads argument `Index` from an HKT instance `Self` after {@link Apply}. */
export type HKTArg<Self, Index extends PropertyKey> =
  Self extends HKTApplication<infer AppliedArgs>
    ? Index extends keyof AppliedArgs
      ? AppliedArgs[Index]
      : never
    : never;

/** Applies HKT `F` to argument tuple `Args` and returns the `[HKT_RESULT]` type. */
export type Apply<F extends HKT, Args> = (F & HKTApplication<Args>)[typeof HKT_RESULT];
