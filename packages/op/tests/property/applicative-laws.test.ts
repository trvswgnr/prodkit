import * as fc from "fast-check";
import { describe, expect, test } from "vitest";
import { Op } from "../../src/index.js";
import { Result } from "../../src/result.js";

/** Applicative apply: independent concurrent product, then combine. */
function ap<A, E1, B, E2>(
  fnOp: Op<(value: A) => B, E1, []>,
  valOp: Op<A, E2, []>,
): Op<B, E1 | E2, []> {
  return Op.all([fnOp, valOp]).map(([fn, val]) => fn(val));
}

async function expectSameOpResult<T, E>(a: Op<T, E, []>, b: Op<T, E, []>) {
  const left = await Op.run(a);
  const right = await Op.run(b);
  expect(Result.serialize(left)).toEqual(Result.serialize(right));
}

const valueFnArb = fc.constantFrom<(value: number) => number>(
  (value) => value + 1,
  (value) => value * 2,
  (value) => value - 3,
  (value) => Math.abs(value),
);

const opArb: fc.Arbitrary<Op<number, string, []>> = fc.oneof(
  fc.integer().map((value) => Op.of(value)),
  fc.string().map((error) => Op.fail(error)),
);

const fnOpArb: fc.Arbitrary<Op<(value: number) => number, string, []>> = valueFnArb.map((fn) =>
  Op.of(fn),
);

describe("Op applicative laws (property-based)", () => {
  test("identity", async () => {
    await fc.assert(
      fc.asyncProperty(opArb, async (valOp) => {
        await expectSameOpResult(
          ap(
            Op.of((value: number) => value),
            valOp,
          ),
          valOp,
        );
      }),
    );
  });

  test("homomorphism", async () => {
    await fc.assert(
      fc.asyncProperty(valueFnArb, fc.integer(), async (fn, value) => {
        await expectSameOpResult(ap(Op.of(fn), Op.of(value)), Op.of(fn(value)));
      }),
    );
  });

  test("interchange", async () => {
    await fc.assert(
      fc.asyncProperty(fnOpArb, fc.integer(), async (fnOp, value) => {
        const left = ap(fnOp, Op.of(value));
        const right = ap(
          Op.of((fn: (input: number) => number) => fn(value)),
          fnOp,
        );
        await expectSameOpResult(left, right);
      }),
    );
  });

  test("composition", async () => {
    const dot =
      (outer: (value: number) => number) => (inner: (value: number) => number) => (value: number) =>
        outer(inner(value));

    await fc.assert(
      fc.asyncProperty(fnOpArb, fnOpArb, opArb, async (outerFnOp, innerFnOp, valOp) => {
        const left = ap(ap(ap(Op.of(dot), outerFnOp), innerFnOp), valOp);
        const right = ap(outerFnOp, ap(innerFnOp, valOp));
        await expectSameOpResult(left, right);
      }),
    );
  });

  test("map agrees with ap", async () => {
    await fc.assert(
      fc.asyncProperty(opArb, valueFnArb, async (valOp, fn) => {
        await expectSameOpResult(valOp.map(fn), ap(Op.of(fn), valOp));
      }),
    );
  });
});
