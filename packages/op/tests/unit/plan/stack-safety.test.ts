import { assert, describe, expect, test } from "vitest";
import { Op } from "../../../src/index.js";
import { Policy } from "../../../src/policy/index.js";

/**
 * Regression coverage for deep-composition stack safety.
 *
 * Recursive yield* composition is represented as child iterator frames that
 * the driver walks iteratively. The loop case below is intentionally shallow
 * delegation and covers repeated sequencing instead of recursive nesting.
 */
describe("deep composition stack safety", () => {
  test("recursively nested yield* returns the correct value at depth 20_000", async () => {
    const depth = 20_000;
    const nested = (remaining: number): Op<number, never, []> =>
      Op(function* () {
        if (remaining === 0) return 0;
        return 1 + (yield* nested(remaining - 1));
      });

    const result = await nested(depth).run();
    assert(result.isOk(), "deep nested yield* composition should succeed");
    expect(result.value).toBe(depth);
  });

  test("recursively nested yield* stays stack-safe when every level suspends", async () => {
    const depth = 20_000;
    const nested = (remaining: number): Op<number, never, []> =>
      Op(function* () {
        if (remaining === 0) return 0;
        yield* Op.try(
          () =>
            new Promise<void>((resolve) => {
              queueMicrotask(resolve);
            }),
        );
        return 1 + (yield* nested(remaining - 1));
      });

    const result = await nested(depth).run();
    assert(result.isOk(), "deep async nested yield* composition should succeed");
    expect(result.value).toBe(depth);
  });

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
