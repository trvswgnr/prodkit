import { assert, describe, expect, test } from "vitest";
import { Op } from "../../src/index.js";
import { UnhandledException } from "../../src/errors.js";

/**
 * Deep-composition stack safety.
 *
 * The generator path trampolines through the async driver and is stack-safe.
 * The fluent / plan-wrapping path (`map`, `flatMap`, `tap`, `mapErr`, `recover`,
 * `on`, and `with(Policy.*)`) descends synchronously through one plan layer per
 * combinator before the first suspend, so a chain a few thousand deep exhausts
 * the call stack.
 *
 * Two failure bands, both observed on Node 22/24:
 *   - ~2_000 .. ~8_400 links: `.run()` resolves to Err(UnhandledException) whose
 *     cause is a RangeError. The result is silently wrong (an error, not the value).
 *   - above ~8_400 links: `.run()` throws the RangeError synchronously, violating
 *     the contract (ADR-0005 / DESIGN.md) that `.run()` always resolves to a Result.
 */
describe("deep composition stack safety", () => {
  // Control: passes today. Idiomatic generator composition is stack-safe.
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

  // BUG (silent-error band): currently resolves to Err(UnhandledException).
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

  // BUG (silent-error band): map has the same shape, with a slightly higher onset.
  test("map chain returns the correct value at depth 3_000", async () => {
    const depth = 3_000;
    let op = Op.of(0);
    for (let i = 0; i < depth; i += 1) op = op.map((x) => x + 1);

    const result = await op.run();
    assert(result.isOk(), "deep map chain should succeed");
    expect(result.value).toBe(depth);
  });

  // BUG (throw band): `.run()` must resolve to a Result, never throw.
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
