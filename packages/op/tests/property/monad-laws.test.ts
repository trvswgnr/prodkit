import * as fc from "fast-check";
import { describe, test } from "vitest";
import { Op } from "../../src/index.js";
import { expectRunEq, FC_ASSERT_OPTIONS, makeKleisliArb, makeOpArb } from "../support/utils.js";

function bind<T, E1, U, E2>(op: Op<T, E1, []>, f: (a: T) => Op<U, E2, []>): Op<U, E1 | E2, []> {
  return op.flatMap(f);
}

describe("Op monad laws", () => {
  test("left identity", async () => {
    const vars = {
      x: fc.anything(),
      f: makeKleisliArb(),
    };

    await fc.assert(
      fc.asyncProperty(vars.x, vars.f, async (x, f) => {
        const left = bind(Op.of(x), f);
        const right = f(x);
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("right identity", async () => {
    const vars = {
      ma: makeOpArb(),
    };
    await fc.assert(
      fc.asyncProperty(vars.ma, async (ma) => {
        const left = bind(ma, Op.of);
        const right = ma;
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("associativity", async () => {
    const vars = {
      ma: makeOpArb(),
      f: makeKleisliArb(),
      g: makeKleisliArb(),
    };

    await fc.assert(
      fc.asyncProperty(vars.ma, vars.f, vars.g, async (ma, f, g) => {
        const left = bind(bind(ma, f), g);
        const right = bind(ma, (x) => bind(f(x), g));
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });
});
