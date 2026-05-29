import * as fc from "fast-check";
import { describe, expect, test } from "vitest";
import { Op } from "../../src/index.js";
import { Result } from "../../src/result.js";

function fmap<A, E, B>(m: Op<A, E, []>, f: (value: A) => B): Op<Awaited<B>, E, []> {
  return m.map(f);
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

describe("Op functor laws (property-based)", () => {
  test("identity", async () => {
    await fc.assert(
      fc.asyncProperty(opArb, async (op) => {
        await expectSameOpResult(
          fmap(op, (value) => value),
          op,
        );
      }),
    );
  });

  test("composition", async () => {
    await fc.assert(
      fc.asyncProperty(opArb, valueFnArb, valueFnArb, async (op, f, g) => {
        await expectSameOpResult(
          fmap(fmap(op, f), g),
          fmap(op, (value) => g(f(value))),
        );
      }),
    );
  });
});
