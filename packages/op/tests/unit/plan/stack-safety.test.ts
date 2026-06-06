import { assert, describe, expect, test } from "vitest";
import { Op } from "../../../src/index.js";
import { Policy } from "../../../src/policy/index.js";

/**
 * Regression coverage for deep-composition stack safety.
 *
 * The generator path trampolines through the async driver and is stack-safe.
 * The fluent / plan-wrapping path should also bind and execute deep valid
 * compositions without treating stack depth as a runtime fault.
 */
describe("deep composition stack safety", () => {
  test("generator yield* loop returns the correct value at depth 50_000", async () => {
    const depth = 50_000;
    const op = Op(function* () {
      let acc = 0;
      for (let i = 0; i < depth; i += 1) acc += yield* Op.of(1);
      return acc;
    });

    const result = await op.run();
    assert(result.isOk(), "generator loop should succeed");
    expect(result.value).toBe(depth);
  });

  test("flatMap chain returns the correct value at depth 3_000", async () => {
    const depth = 3_000;
    let op = Op.of(0);
    for (let i = 0; i < depth; i += 1) op = op.flatMap((x) => Op.of(x + 1));

    const result = await op.run();
    assert(
      result.isOk(),
      "deep flatMap chain should succeed, not fail with a stack-overflow UnhandledException",
    );
    expect(result.value).toBe(depth);
  });

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

  test("flatMap chain returns the correct value at depth 20_000", async () => {
    const depth = 20_000;
    let op = Op.of(0);
    for (let i = 0; i < depth; i += 1) op = op.flatMap((x) => Op.of(x + 1));

    const result = await op.run();
    assert(
      result.isOk(),
      "deep flatMap chain should succeed via trampoline, not Err(UnhandledException) from stack overflow",
    );
    expect(result.value).toBe(depth);
  });
});
