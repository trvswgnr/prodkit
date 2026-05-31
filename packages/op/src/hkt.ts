/** Symbol key for the argument tuple applied to an HKT instance. */
const PARAMS = Symbol("prodkit.hkt.params");

/** Symbol key for the applied type produced by an HKT instance. */
const TYPE = Symbol("prodkit.hkt.type");

/**
 * Encoding for a higher-kinded type
 *
 * @example
 * type Maybe<A> =
 *   | { readonly _tag: "Some"; readonly value: A }
 *   | { readonly _tag: "None" };
 *
 * interface MaybeF extends HKT {
 *   readonly [HKT.TYPE]: Maybe<HKT.Param<this, 0>>;
 * }
 *
 * type Name = HKT.Apply<MaybeF, readonly [string]>;
 * //   ^? Maybe<string>
 */
export interface HKT extends HKT.Parameterized<readonly unknown[]> {
  readonly [TYPE]: unknown;
}

export const HKT = Object.freeze({ PARAMS, TYPE });

export namespace HKT {
  export type PARAMS = typeof PARAMS;
  export type TYPE = typeof TYPE;

  /** Phantom slot carrying the argument tuple for an {@link Apply} instantiation. */
  export interface Parameterized<Args extends readonly unknown[]> {
    readonly [PARAMS]: Args;
  }

  /** Gets the `N`th argument from an HKT instance */
  export type Param<Self extends HKT, N extends keyof Self[PARAMS]> = Self[PARAMS][N];

  /**
   * Value-level witness that constructor `F` is already applied to `Args`.
   *
   * Compositional helpers such as {@link Fix12} should target the bare constructor
   * (`Fix12<F, ...>`), not `Fix12<Applied<F, Args>, ...>`: {@link Apply} intersects a new
   * arg tuple onto `[PARAMS]`, so rebinding an {@link Applied} instance collides with the
   * stored tuple and collapses slots to `never`.
   */
  export type Applied<F extends HKT, Args extends readonly unknown[]> = F & Parameterized<Args>;

  /** Applies HKT `F` to argument tuple `Args` and returns the `[TYPE]` type. */
  export type Apply<F extends HKT, Args extends readonly unknown[]> = (F &
    Parameterized<Args>)[typeof TYPE];

  /** Composes two HKTs: the applied type of `G` on the first argument flows into `F`. */
  export interface Compose<F extends HKT, G extends HKT> extends HKT {
    readonly [TYPE]: Apply<F, [Apply<G, [Param<this, 0>]>]>;
  }

  /** Swaps the first two arguments before applying `F`. */
  export interface Flip<F extends HKT> extends HKT {
    readonly [TYPE]: Apply<F, [Param<this, 1>, Param<this, 0>]>;
  }

  /** Fixes the first argument to `A` before applying `F`. */
  export interface Fix1<F extends HKT, A> extends HKT {
    readonly [TYPE]: Apply<F, [A, Param<this, 0>]>;
  }

  /** Fixes the second argument to `B` before applying `F`. */
  export interface Fix2<F extends HKT, B> extends HKT {
    readonly [TYPE]: Apply<F, [Param<this, 0>, B]>;
  }

  /** Fixes the first two arguments to `A` and `B` before applying `F`. */
  export interface Fix12<F extends HKT, A, B> extends HKT {
    readonly [TYPE]: Apply<F, [A, B, Param<this, 0>]>;
  }
}
