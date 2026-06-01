import { assert, describe, expect, test, vi } from "vitest";
import { Op, TimeoutError, type ExitContext } from "../../src/index.js";
import { UnhandledException } from "../../src/errors.js";
import { Policy } from "../../src/policy/index.js";

describe('op.on("exit")', () => {
  test('.on("exit") runs finalizer after success', async () => {
    const finalize = vi.fn();
    const result = await Op.of(123)
      .on("exit", () => {
        finalize();
      })
      .run();

    assert(result.isOk(), "should be Ok");
    expect(result.value).toBe(123);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('chains .on("exit") in LIFO order with inner registration running first', async () => {
    const order: string[] = [];
    await Op.of(1)
      .on("exit", () => {
        order.push("a");
      })
      .on("exit", () => {
        order.push("b");
      })
      .run();
    expect(order).toEqual(["a", "b"]);
  });

  test('.on("exit") preserves fluent combinators', async () => {
    const finalize = vi.fn();
    const result = await Op.of(1).with(Policy.retry()).on("exit", finalize).run();
    assert(result.isOk());
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test("runs finalizer after typed failure", async () => {
    const finalize = vi.fn();
    const result = await Op.fail("boom" as const)
      .on("exit", () => {
        finalize();
      })
      .run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBe("boom");
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test("preserves inferred op shapes", () => {
    const p1 = Op.of({ id: 1 }).on("exit", () => {});
    const p2 = Op(function* (name: string) {
      return name.length;
    }).on("exit", () => {});
    expect(typeof p1.run).toBe("function");
    expect(typeof p2.run).toBe("function");
  });

  test('.on("exit") ExitContext.result is the pre-finalizer Result when cleanup succeeds', async () => {
    let okCtx!: ExitContext<number, never>;
    const ok = await Op.of(99)
      .on("exit", (c) => {
        okCtx = c;
      })
      .run();
    assert(ok.isOk());
    assert(okCtx !== undefined);
    expect(okCtx.result).toBe(ok);
    expect(okCtx.signal.aborted).toBe(false);
    expect(okCtx.args).toEqual([]);

    let typedCtx!: ExitContext<never, string>;
    const typedErr = await Op.fail("no")
      .on("exit", (c) => {
        typedCtx = c;
      })
      .run();
    assert(typedErr.isErr());
    assert(typedCtx !== undefined);
    expect(typedCtx.result).toBe(typedErr);
    expect(typedCtx.args).toEqual([]);

    let throwCtx!: ExitContext<never, never>;
    const boom = new Error("sync");
    const syncThrowOp = Op(function* () {
      throw boom;
    });
    const threw = await syncThrowOp
      .on("exit", (c) => {
        throwCtx = c;
      })
      .run();
    assert(threw.isErr());
    expect(throwCtx).toBeDefined();
    expect(throwCtx.result).toBe(threw);
    expect(throwCtx.args).toEqual([]);
  });

  test('.on("exit") ExitContext.result is the pre-finalizer timeout Result', async () => {
    vi.useFakeTimers();
    try {
      let timedCtx!: ExitContext<number, UnhandledException | TimeoutError>;
      const runPromise = Op.try((_signal) => new Promise<number>(() => {}))
        .with(Policy.timeout(10))
        .on("exit", (c) => {
          timedCtx = c;
        })
        .run();
      await vi.advanceTimersByTimeAsync(10);
      await vi.runOnlyPendingTimersAsync();
      const timed = await runPromise;

      assert(timed.isErr());
      expect(timedCtx).toBeDefined();
      expect(timedCtx.result).toBe(timed);
      expect(timedCtx.args).toEqual([]);
      expect(timed.error).toBeInstanceOf(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  test('.on("exit") ExitContext.result remains the pre-finalizer Result when cleanup fails', async () => {
    let seenCtx!: ExitContext<number, never>;
    const cleanupFault = new Error("cleanup failed");
    const result = await Op.of(99)
      .on("exit", (ctx) => {
        seenCtx = ctx;
        throw cleanupFault;
      })
      .run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    if (result.error instanceof UnhandledException) {
      expect(result.error.cause).toBe(cleanupFault);
    }
    expect(seenCtx.result.isOk()).toBe(true);
    expect(seenCtx.result).not.toBe(result);
  });

  test("Policy.timeout waits for async exit finalizers before run settles", async () => {
    vi.useFakeTimers();
    try {
      let finalized = false;
      let settled = false;
      const runPromise = Op.try((_signal) => new Promise<number>(() => {}))
        .with(Policy.timeout(10))
        .on("exit", async () => {
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              finalized = true;
              resolve();
            }, 20);
          });
        })
        .run();
      void runPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(10);
      await vi.runOnlyPendingTimersAsync();
      // Same observation checkpoint as release cleanup: after timeout, before exit timer fires.
      await Promise.resolve();

      expect(settled).toBe(false);
      expect(finalized).toBe(false);

      await vi.advanceTimersByTimeAsync(20);

      const result = await runPromise;
      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(finalized).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('.on("exit") receives runtime args for arity ops', async () => {
    let seenCtx!: ExitContext<number, never, [string]>;
    const result = await Op(function* (name: string) {
      return name.length;
    })
      .on("exit", (ctx) => {
        seenCtx = ctx;
      })
      .run("gamma");

    assert(result.isOk(), "should be Ok");
    expect(result.value).toBe(5);
    expect(seenCtx.args).toEqual(["gamma"]);
    expect(seenCtx.result).toBe(result);
  });
});
