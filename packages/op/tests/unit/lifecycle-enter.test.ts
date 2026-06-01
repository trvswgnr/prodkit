import { assert, describe, expect, test, vi } from "vitest";
import { Op, TimeoutError, type EnterContext } from "../../src/index.js";
import { Policy } from "../../src/policy/index.js";

describe('op.on("enter")', () => {
  test('.on("enter") runs initializer before success path starts', async () => {
    const events: string[] = [];
    let seenCtx!: EnterContext;
    const result = await Op(function* () {
      events.push("body");
      return 123;
    })
      .on("enter", (ctx) => {
        seenCtx = ctx;
        events.push("enter");
      })
      .run();

    assert(result.isOk(), "should be Ok");
    expect(result.value).toBe(123);
    expect(events).toEqual(["enter", "body"]);
    expect(seenCtx.signal).toBeInstanceOf(AbortSignal);
    expect(seenCtx.args).toEqual([]);
  });

  test('.on("enter") runs before body when downstream fails', async () => {
    const events: string[] = [];
    const result = await Op(function* () {
      events.push("body");
      return yield* Op.fail("boom" as const);
    })
      .on("enter", () => {
        events.push("enter");
      })
      .run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBe("boom");
    expect(events).toEqual(["enter", "body"]);
  });

  test('chained .on("enter") handlers run in wrapper/LIFO order', async () => {
    const order: string[] = [];
    const result = await Op.of(1)
      .on("enter", () => {
        order.push("a");
      })
      .on("enter", () => {
        order.push("b");
      })
      .run();

    assert(result.isOk(), "should be Ok");
    expect(order).toEqual(["b", "a"]);
  });

  test('composition with .on("exit") keeps enter-before-body and exit-after-settle ordering', async () => {
    const events: string[] = [];
    const result = await Op.of(1)
      .on("enter", () => {
        events.push("enter-a");
      })
      .on("enter", () => {
        events.push("enter-b");
      })
      .on("exit", () => {
        events.push("exit-a");
      })
      .on("exit", () => {
        events.push("exit-b");
      })
      .run();

    assert(result.isOk(), "should be Ok");
    expect(events).toEqual(["enter-b", "enter-a", "exit-a", "exit-b"]);
  });

  test("runs once regardless of position in chain", async () => {
    const policy = {
      retries: 2,
      when: () => true,
      delay: () => 0,
    };
    const runCase = async (order: "before-retry" | "after-retry") => {
      let attempts = 0;
      const enter = vi.fn();
      const base = Op.try(() => {
        attempts += 1;
        if (attempts < 3) throw new Error(`fail-${attempts}`);
        return 69;
      });
      const op =
        order === "before-retry"
          ? base.on("enter", enter).with(Policy.retry(policy))
          : base.with(Policy.retry(policy)).on("enter", enter);
      const result = await op.run();
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(69);
      expect(enter).toHaveBeenCalledTimes(1);
    };

    await runCase("before-retry");
    await runCase("after-retry");
  });

  test('.on("enter") still runs when run later times out', async () => {
    vi.useFakeTimers();
    try {
      const enter = vi.fn();
      const runPromise = Op.try((_signal) => new Promise<number>(() => {}))
        .on("enter", enter)
        .with(Policy.timeout(10))
        .run();
      await vi.advanceTimersByTimeAsync(10);
      await vi.runOnlyPendingTimersAsync();
      const result = await runPromise;

      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(enter).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('.on("enter") receives runtime args for arity ops', async () => {
    let seenCtx!: EnterContext<[string, number]>;
    const result = await Op(function* (name: string, retries: number) {
      return `${name}:${retries}`;
    })
      .on("enter", (ctx) => {
        seenCtx = ctx;
      })
      .run("cache", 3);

    assert(result.isOk(), "should be Ok");
    expect(result.value).toBe("cache:3");
    expect(seenCtx.args).toEqual(["cache", 3]);
  });
});
