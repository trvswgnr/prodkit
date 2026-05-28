import { assert, describe, expect, test } from "vitest";
import { Op } from "../../../../src/index.js";
import { runOp } from "../../../../src/core/run-op.js";
import { createRunContext } from "../../../../src/core/runtime.js";
import { getPlan } from "../../../../src/core/plan/base.js";

async function expectPlanMatchesRun<T, E>(op: Op<T, E, []>) {
  const plan = getPlan(op, []);
  const planResult = await plan.execute(createRunContext(new AbortController().signal));
  const runResult = await runOp(op);

  expect(planResult.isOk()).toBe(runResult.isOk());
  if (planResult.isOk()) {
    assert(runResult.isOk(), "run should be Ok");
    expect(planResult.value).toEqual(runResult.value);
    return;
  }

  assert(runResult.isErr(), "run should be Err");
  expect(planResult.error).toEqual(runResult.error);
}

describe("internal Plan leaves", () => {
  test("Op.of leaf execution matches runOp", async () => {
    await expectPlanMatchesRun(Op.of(69));
  });

  test("Op.fail leaf execution matches runOp", async () => {
    await expectPlanMatchesRun(Op.fail("bad-input" as const));
  });

  test("Op.try success leaf execution matches runOp", async () => {
    await expectPlanMatchesRun(Op.try(() => Promise.resolve(69)));
  });

  test("Op.try mapped failure leaf execution matches runOp", async () => {
    const op = Op.try(
      () => Promise.reject("raw"),
      (cause) => `mapped:${String(cause)}`,
    );

    const plan = getPlan(op, []);
    const planResult = await plan.execute(createRunContext(new AbortController().signal));
    assert(planResult.isErr(), "plan should be Err");
    expect(planResult.error).toBe("mapped:raw");

    const runResult = await runOp(op);
    assert(runResult.isErr(), "run should be Err");
    expect(planResult.error).toEqual(runResult.error);
  });
});
