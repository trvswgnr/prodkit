import { assert, describe, expect, test } from "vitest";
import { Op } from "../../../src/index.js";
import { Policy } from "../../../src/policy/index.js";

describe("deep Plan composition", () => {
  test("map chain returns the correct value at depth 3_000", async () => {
    const depth = 3_000;
    let op = Op.of(0);
    for (let i = 0; i < depth; i += 1) op = op.map((x) => x + 1);

    const result = await op.run();
    assert(result.isOk(), "deep map chain should succeed");
    expect(result.value).toBe(depth);
  });

  test("stacked policies on invoked deep unary op return the correct value", async () => {
    const unaryDepth = 800;
    const policyCount = 128;

    let op = Op(function* (x: number) {
      return x;
    });
    for (let i = 0; i < unaryDepth; i += 1) op = op.map((x) => x + 1);

    let bound = op(unaryDepth);
    for (let i = 0; i < policyCount; i += 1) {
      bound = bound.with(Policy.retry({ retries: 0 }));
    }

    const result = await bound.run();
    assert(result.isOk(), "stacked policies on invoked deep unary op should succeed");
    expect(result.value).toBe(unaryDepth * 2);
  });

  test("mixed policy and fluent wrapper chain returns the correct value at depth 3_000", async () => {
    const depth = 3_000;
    let op = Op.of(0);
    for (let i = 0; i < depth; i += 1) {
      op = op.with(Policy.retry({ retries: 0 })).map((x) => x + 1);
    }

    const result = await op.run();
    assert(result.isOk(), "deep policy/fluent chain should succeed");
    expect(result.value).toBe(depth);
  });
});
