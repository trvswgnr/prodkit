import { describe, expectTypeOf, test } from "vitest";
import { HKT } from "../../src/hkt.js";

type Some<T> = { readonly _tag: "Some"; readonly value: T };
type None = { readonly _tag: "None" };
type Maybe<T> = Some<T> | None;

interface MaybeF extends HKT {
  readonly [HKT.TYPE]: Maybe<HKT.Param<this, 0>>;
}

type Left<E> = { readonly _tag: "Left"; readonly left: E };
type Right<A> = { readonly _tag: "Right"; readonly right: A };
type Either<E, A> = Left<E> | Right<A>;

interface EitherF extends HKT {
  readonly [HKT.TYPE]: Either<HKT.Param<this, 0>, HKT.Param<this, 1>>;
}

type Box<A, B, C> = {
  readonly _tag: "Box";
  readonly a: A;
  readonly b: B;
  readonly c: C;
};

interface BoxF extends HKT {
  readonly [HKT.TYPE]: Box<HKT.Param<this, 0>, HKT.Param<this, 1>, HKT.Param<this, 2>>;
}

interface BrandF extends HKT {
  readonly [HKT.TYPE]: `id:${string & HKT.Param<this, 0>}`;
}

describe("generic HKT helpers", () => {
  test("Apply instantiates a reusable type constructor", () => {
    expectTypeOf<HKT.Apply<MaybeF, [string]>>().toEqualTypeOf<Maybe<string>>();
  });

  test("Fix1 fixes the first type argument before applying F", () => {
    type HttpError = { readonly status: number };

    expectTypeOf<HKT.Apply<HKT.Fix1<EitherF, HttpError>, [string]>>().toEqualTypeOf<
      Either<HttpError, string>
    >();
  });

  test("Fix2 fixes the second type argument before applying F", () => {
    expectTypeOf<HKT.Apply<HKT.Fix2<EitherF, string>, [number]>>().toEqualTypeOf<
      Either<number, string>
    >();
  });

  test("Fix12 fixes the first two type arguments before applying F", () => {
    expectTypeOf<HKT.Apply<HKT.Fix12<EitherF, "err", number>, [never]>>().toEqualTypeOf<
      Either<"err", number>
    >();
  });

  test("Flip swaps the first two arguments before applying F", () => {
    expectTypeOf<HKT.Apply<HKT.Flip<EitherF>, [number, string]>>().toEqualTypeOf<
      Either<string, number>
    >();
  });

  test("Fix12 transform works over any applied constructor", () => {
    const transform = <F extends HKT, const Args extends readonly unknown[], const R>(
      _box: HKT.Applied<F, Args>,
      _result: R,
    ): HKT.Apply<HKT.Fix12<F, 1, 2>, [R]> => {
      return null as never;
    };

    const createBox = <const A, const B, const C>(
      a: A,
      b: B,
      c: C,
    ): HKT.Applied<BoxF, [A, B, C]> => {
      return { _tag: "Box", a, b, c } as never;
    };

    type Triple<A, B, C> = { readonly x: A; readonly y: B; readonly z: C };
    interface TripleF extends HKT {
      readonly [HKT.TYPE]: Triple<HKT.Param<this, 0>, HKT.Param<this, 1>, HKT.Param<this, 2>>;
    }

    const createTriple = <const A, const B, const C>(
      x: A,
      y: B,
      z: C,
    ): HKT.Applied<TripleF, [A, B, C]> => {
      return { x, y, z } as never;
    };

    const createMaybe = <const A>(value: A): HKT.Applied<MaybeF, [A]> => {
      return { _tag: "Some", value } as never;
    };

    const box = createBox("a", "b", "c");
    const triple = createTriple(true, 9, "z");
    const maybe = createMaybe("x");

    expectTypeOf(transform(box, "d")).toEqualTypeOf<Box<1, 2, "d">>();
    expectTypeOf(transform(triple, 4n)).toEqualTypeOf<Triple<1, 2, 4n>>();

    // since Maybe only has one slot, the result type is the same as the argument type
    expectTypeOf(transform(maybe, 4)).toEqualTypeOf<Maybe<1>>();
  });

  test("Compose threads the applied type of G into F", () => {
    expectTypeOf<HKT.Apply<HKT.Compose<MaybeF, BrandF>, ["user"]>>().toEqualTypeOf<
      Maybe<"id:user">
    >();
  });
});
