import * as fc from "fast-check";
import { describe, test } from "vitest";
import { Op } from "../../src/index.js";
import { identity } from "@prodkit/shared/runtime";
import { expectRunEq, FC_ASSERT_OPTIONS, makeKleisliArb, makeOpArb } from "../support/utils.js";

function fmap<A, E, B>(op: Op<A, E, []>, f: (x: A) => B): Op<Awaited<B>, E, []> {
  return op.map(f);
}

describe("Op functor laws", () => {
  test("identity", async () => {
    const vars = {
      op: makeOpArb(),
    };
    await fc.assert(
      fc.asyncProperty(vars.op, async (ma) => {
        const left = fmap(ma, identity);
        const right = identity(ma);
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("composition", async () => {
    const vars = {
      ma: makeOpArb(),
      f: makeKleisliArb(),
      g: makeKleisliArb(),
    };
    await fc.assert(
      fc.asyncProperty(vars.ma, vars.f, vars.g, async (ma, f, g) => {
        const left = fmap(fmap(ma, f), g);
        const right = fmap(ma, (x) => g(f(x)));
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });
});
