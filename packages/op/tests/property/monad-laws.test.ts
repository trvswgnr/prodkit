import * as fc from "fast-check";
import { describe, test } from "vitest";
import { Op } from "../../src/index.js";
import { expectRunEq, FC_ASSERT_OPTIONS } from "../support/utils.js";

function bind<T, E1, U, E2>(op: Op<T, E1, []>, f: (a: T) => Op<U, E2, []>): Op<U, E1 | E2, []> {
  return op.flatMap(f);
}

describe("Op monad laws", () => {
  test("left identity", async () => {
    const arb = {
      x: fc.anything(),
      f: fc.func(fc.anything().map(Op.of)),
    };

    await fc.assert(
      fc.asyncProperty(arb.x, arb.f, async (x, f) => {
        const left = bind(Op.of(x), f);
        const right = f(x);
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("right identity", async () => {
    const arb = {
      op: fc.anything().map(Op.of),
    };
    await fc.assert(
      fc.asyncProperty(arb.op, async (op) => {
        const left = bind(op, Op.of);
        const right = op;
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("associativity", async () => {
    const arb = {
      x: fc.anything().map(Op.of),
      f: fc.func(fc.anything().map(Op.of)),
      g: fc.func(fc.anything().map(Op.of)),
    };

    await fc.assert(
      fc.asyncProperty(arb.x, arb.f, arb.g, async (op, f, g) => {
        const left = bind(bind(op, f), g);
        const right = bind(op, (a) => bind(f(a), g));
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });
});
