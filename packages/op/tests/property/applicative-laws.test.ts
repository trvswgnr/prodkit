import * as fc from "fast-check";
import { describe, test } from "vitest";
import { Op } from "../../src/index.js";
import { identity } from "@prodkit/shared/runtime";
import { expectRunEq, FC_ASSERT_OPTIONS } from "../support/utils.js";

/** Applicative apply: independent concurrent product, then combine. */
function ap<A, E1, B, E2>(
  fnOp: Op<(value: A) => B, E1, []>,
  valOp: Op<A, E2, []>,
): Op<B, E1 | E2, []> {
  return Op.all([fnOp, valOp]).map(([fn, val]) => fn(val));
}

describe("Op applicative laws", () => {
  test("identity", async () => {
    const arb = {
      op: fc.anything().map(Op.of),
    };
    await fc.assert(
      fc.asyncProperty(arb.op, async (op) => {
        const left = ap(Op.of(identity), op);
        const right = op;
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("homomorphism", async () => {
    const arb = {
      f: fc.func(fc.anything()),
      x: fc.anything(),
    };
    await fc.assert(
      fc.asyncProperty(arb.f, arb.x, async (f, x) => {
        const left = ap(Op.of(f), Op.of(x));
        const right = Op.of(f(x));
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("interchange", async () => {
    const applyAt =
      <A>(a: A) =>
      <B>(f: (a: A) => B) =>
        f(a);

    const arb = {
      f: fc.func(fc.anything()).map(Op.of),
      x: fc.anything(),
    };

    await fc.assert(
      fc.asyncProperty(arb.f, arb.x, async (f, x) => {
        const left = ap(f, Op.of(x));
        const right = ap(Op.of(applyAt(x)), f);
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("composition", async () => {
    const dot =
      <A, B, C>(f: (b: B) => C) =>
      (g: (a: A) => B) =>
      (a: A) =>
        f(g(a));

    const arb = {
      f: fc.func(fc.anything()).map(Op.of),
      g: fc.func(fc.anything()).map(Op.of),
      op: fc.anything().map(Op.of),
    };

    await fc.assert(
      fc.asyncProperty(arb.f, arb.g, arb.op, async (f, g, op) => {
        const left = ap(ap(ap(Op.of(dot), f), g), op);
        const right = ap(f, ap(g, op));
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("map agrees with ap", async () => {
    const arb = {
      op: fc.anything().map(Op.of),
      f: fc.func(fc.anything()),
    };
    await fc.assert(
      fc.asyncProperty(arb.op, arb.f, async (op, f) => {
        const left = op.map(f);
        const right = ap(Op.of(f), op);
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });
});
