import * as fc from "fast-check";
import { describe, test } from "vitest";
import { Op } from "../../src/index.js";
import { identity } from "@prodkit/shared/runtime";
import { expectRunEq, FC_ASSERT_OPTIONS } from "../support/utils.js";

function fmap<A, E, B>(op: Op<A, E, []>, f: (x: A) => B): Op<Awaited<B>, E, []> {
  return op.map(f);
}

describe("Op functor laws", () => {
  test("identity", async () => {
    const arb = {
      op: fc.anything().map(Op.of),
    };
    await fc.assert(
      fc.asyncProperty(arb.op, async (op) => {
        const left = fmap(op, identity);
        const right = identity(op);
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("composition", async () => {
    const arb = {
      op: fc.anything().map(Op.of),
      f: fc.func(fc.anything().map(Op.of)),
      g: fc.func(fc.anything().map(Op.of)),
    };
    await fc.assert(
      fc.asyncProperty(arb.op, arb.f, arb.g, async (op, f, g) => {
        const left = fmap(fmap(op, f), g);
        const right = fmap(op, (x) => g(f(x)));
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });
});
