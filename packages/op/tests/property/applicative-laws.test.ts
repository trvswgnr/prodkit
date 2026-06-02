import * as fc from "fast-check";
import { describe, test } from "vitest";
import { Op } from "../../src/index.js";
import { identity } from "@prodkit/shared/runtime";
import { expectRunEq, FC_ASSERT_OPTIONS, makeOpArb, makeOpFuncArb } from "../support/utils.js";

/** Applicative apply: independent concurrent product, then combine. */
function ap<A, E1, B, E2>(
  fnOp: Op<(value: A) => B, E1, []>,
  valOp: Op<A, E2, []>,
): Op<B, E1 | E2, []> {
  return Op.all([fnOp, valOp]).map(([fn, val]) => fn(val));
}

describe("Op applicative laws", () => {
  test("identity", async () => {
    const vars = {
      ma: makeOpArb(),
    };
    await fc.assert(
      fc.asyncProperty(vars.ma, async (ma) => {
        const left = ap(Op.of(identity), ma);
        const right = ma;
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("homomorphism", async () => {
    const vars = {
      f: fc.func(fc.anything()),
      x: fc.anything(),
    };
    await fc.assert(
      fc.asyncProperty(vars.f, vars.x, async (f, x) => {
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

    const vars = {
      mf: makeOpFuncArb(),
      x: fc.anything(),
    };

    await fc.assert(
      fc.asyncProperty(vars.mf, vars.x, async (mf, x) => {
        const left = ap(mf, Op.of(x));
        const right = ap(Op.of(applyAt(x)), mf);
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

    const vars = {
      mf: fc.func(fc.anything()).map(Op.of),
      mg: fc.func(fc.anything()).map(Op.of),
      ma: fc.anything().map(Op.of),
    };

    await fc.assert(
      fc.asyncProperty(vars.mf, vars.mg, vars.ma, async (mf, mg, ma) => {
        const left = ap(ap(ap(Op.of(dot), mf), mg), ma);
        const right = ap(mf, ap(mg, ma));
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("map agrees with ap", async () => {
    const vars = {
      ma: makeOpArb(),
      f: fc.func(fc.anything()),
    };
    await fc.assert(
      fc.asyncProperty(vars.ma, vars.f, async (ma, f) => {
        const left = ma.map(f);
        const right = ap(Op.of(f), ma);
        await expectRunEq(left, right);
      }),
      FC_ASSERT_OPTIONS,
    );
  });
});

describe("Op ap error propagation", () => {
  test("binary ap outcome by fn and val results", async () => {
    const vars = {
      mf: makeOpFuncArb(),
      ma: makeOpArb(),
    };

    await fc.assert(
      fc.asyncProperty(vars.mf, vars.ma, async (mf, ma) => {
        const fnResult = await mf.run();
        const valResult = await ma.run();
        if (fnResult.isErr() && valResult.isErr()) {
          await expectRunEq(ap(mf, ma), Op.all([mf, ma]));
          return;
        }
        if (fnResult.isOk() && valResult.isErr()) {
          await expectRunEq(ap(mf, ma), ma);
          return;
        }
        if (fnResult.isErr() && valResult.isOk()) {
          await expectRunEq(ap(mf, ma), mf);
          return;
        }
        if (fnResult.isOk() && valResult.isOk()) {
          await expectRunEq(ap(mf, ma), Op.of(fnResult.value(valResult.value)));
          return;
        }
        throw new Error("unreachable");
      }),
      FC_ASSERT_OPTIONS,
    );
  });

  test("nested ap propagates inner failure", async () => {
    const vars = {
      mf: makeOpFuncArb(),
      mg: makeOpFuncArb(),
      ma: makeOpArb(),
    };

    await fc.assert(
      fc.asyncProperty(vars.mf, vars.mg, vars.ma, async (mf, mg, ma) => {
        const inner = ap(mg, ma);
        const [fnResult, innerResult] = await Promise.all([mf.run(), inner.run()]);
        if (fnResult.isErr() && innerResult.isOk()) {
          await expectRunEq(ap(mf, inner), mf);
          return;
        }
        if (fnResult.isOk() && innerResult.isErr()) {
          await expectRunEq(ap(mf, inner), inner);
          return;
        }
        if (fnResult.isOk() && innerResult.isOk()) {
          await expectRunEq(ap(mf, inner), Op.of(fnResult.value(innerResult.value)));
          return;
        }
        if (fnResult.isErr() && innerResult.isErr()) {
          await expectRunEq(ap(mf, inner), Op.all([mf, inner]));
          return;
        }
        throw new Error("unreachable");
      }),
      FC_ASSERT_OPTIONS,
    );
  });
});
