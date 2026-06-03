import { assert, describe, expect, test } from "vitest";
import { Op } from "../../src/index.js";
import { UnhandledException } from "../../src/errors.js";
import { Policy } from "../../src/policy/index.js";

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

  test("run() resolves to a Result for a very deep chain instead of throwing", async () => {
    const depth = 20_000;
    let op = Op.of(0);
    for (let i = 0; i < depth; i += 1) op = op.flatMap((x) => Op.of(x + 1));

    // The contract is that runtime faults settle on the UnhandledException
    // channel. Awaiting must not throw.
    const result = await op.run();
    assert(
      result.isOk() || (result.isErr() && UnhandledException.is(result.error)),
      "run() should resolve to a Result",
    );
  });
});
