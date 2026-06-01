import { assert, describe, expect, test, vi } from "vitest";
import { Op, TimeoutError, type ExitContext } from "../../src/index.js";
import { UnhandledException } from "../../src/errors.js";
import { Policy } from "../../src/policy/index.js";
import { neverSettling } from "../support/utils.js";

describe("Op.defer error handling", () => {
  test("when op succeeds, cleanup throws: UnhandledException with cleanup error as cause", async () => {
    const cleanupError = new Error("cleanup failed");
    const cleanup = () => {
      throw cleanupError;
    };
    const safeOp = Op.of(69);
    const op = Op(function* () {
      yield* Op.defer(() => cleanup());
      const r = yield* safeOp;
      return r;
    });
    const r = await op.run();
    assert(r.isErr(), "should be Err");
    expect(r.error).toBeInstanceOf(UnhandledException);
    if (r.error instanceof UnhandledException) {
      expect(r.error.cause).toBe(cleanupError);
    }
  });

  test("when op fails, cleanup throws: UnhandledException with cleanup error as cause", async () => {
    const cleanupError = new Error("cleanup failed");
    const cleanup = () => {
      throw cleanupError;
    };
    const riskyOp = Op.fail("boom");
    const op = Op(function* () {
      yield* Op.defer(() => cleanup());
      yield* riskyOp;
    });
    const r = await op.run();
    assert(r.isErr(), "should be Err");
    assert(r.error instanceof UnhandledException, "should be UnhandledException");
    expect(r.error.cause).toBe(cleanupError);
  });

  test("when op fails, cleanup succeeds: failure is preserved", async () => {
    const cleanup = () => {
      return;
    };
    const riskyOp = Op.fail("boom");
    const op = Op(function* () {
      yield* Op.defer(() => cleanup());
      yield* riskyOp;
    });
    const r = await op.run();
    assert(r.isErr(), "should be Err");
    expect(r.error).toBe("boom");
  });

  test("when op fails, async cleanup completes before run settles", async () => {
    let cleaned = false;
    const op = Op(function* () {
      yield* Op.defer(async () => {
        await Promise.resolve();
        cleaned = true;
      });
      return yield* Op.fail("boom" as const);
    });

    const result = await op.run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBe("boom");
    expect(cleaned).toBe(true);
  });

  test("when op succeeds, cleanup succeeds: value is preserved", async () => {
    const cleanup = () => {
      return;
    };
    const safeOp = Op.of(69);
    const op = Op(function* () {
      yield* Op.defer(() => cleanup());
      return yield* safeOp;
    });
    const r = await op.run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(69);
  });
});

describe("Op.defer ordering and policies", () => {
  test("Op.defer receives runtime args for arity ops", async () => {
    let seenCtx!: ExitContext<unknown, unknown, readonly unknown[]>;
    const result = await Op(function* (name: string) {
      yield* Op.defer((ctx) => {
        seenCtx = ctx;
      });
      return name.length;
    }).run("gamma");

    assert(result.isOk(), "should be Ok");
    expect(result.value).toBe(5);
    expect(seenCtx.args).toEqual(["gamma"]);
    expect(seenCtx.result).toBe(result);
  });

  test("Op.defer in nested arity op sees inner runtime args, not outer run args", async () => {
    let seenCtx!: ExitContext<unknown, unknown, readonly unknown[]>;
    const inner = Op(function* (left: string, right: number) {
      yield* Op.defer((ctx) => {
        seenCtx = ctx;
      });
      return `${left}:${right}`;
    });

    const outer = Op(function* (prefix: string) {
      const value = yield* inner("inner", 7);
      return `${prefix}:${value}`;
    });

    const result = await outer.run("outer");
    assert(result.isOk(), "should be Ok");
    expect(result.value).toBe("outer:inner:7");
    expect(seenCtx.args).toEqual(["inner", 7]);
  });

  test("runs multiple defers in LIFO order on success", async () => {
    const events: string[] = [];
    const op = Op(function* () {
      yield* Op.defer(() => {
        events.push("first");
      });
      yield* Op.defer(() => {
        events.push("second");
      });
      return yield* Op.of(1);
    });
    const r = await op.run();
    assert(r.isOk(), "should be Ok");
    expect(events).toEqual(["second", "first"]);
  });

  test("runs earlier-registered finalizers after a later defer throws", async () => {
    const earlier = vi.fn();
    const stop = new Error("stop");
    const op = Op(function* () {
      yield* Op.defer(() => {
        earlier();
      });
      yield* Op.defer(() => {
        throw stop;
      });
      return yield* Op.of(1);
    });
    const r = await op.run();
    assert(r.isErr(), "should be Err");
    expect(earlier).toHaveBeenCalledTimes(1);
    expect(r.error).toBeInstanceOf(UnhandledException);
    if (r.error instanceof UnhandledException) {
      expect(r.error.cause).toBe(stop);
    }
  });

  test("chains multiple cleanup throws via nested Error.cause", async () => {
    const boomFourth = new Error("boom from defer fourth");
    const boomSecond = new Error("boom from defer second");
    const events: string[] = [];
    const op = Op(function* () {
      yield* Op.defer(() => {
        events.push("first");
      });
      yield* Op.defer(() => {
        events.push("second");
        throw boomSecond;
      });
      yield* Op.defer(() => {
        events.push("third");
      });
      yield* Op.defer(() => {
        events.push("fourth");
        throw boomFourth;
      });
      return yield* Op.of(1);
    });
    const r = await op.run();
    assert(r.isErr(), "should be Err");
    expect(events).toEqual(["fourth", "third", "second", "first"]);
    assert(r.error instanceof UnhandledException);
    const ue = r.error;
    assert(ue.cause instanceof Error);
    expect(ue.cause.message).toBe(boomFourth.message);
    expect(ue.cause.name).toBe(boomFourth.name);
    expect(ue.cause.cause).toBe(boomSecond);
  });

  test("chains three throws among five defers (only throwing cleanups in cause chain)", async () => {
    const boomFifth = new Error("boom from defer fifth");
    const boomFourth = new Error("boom from defer fourth");
    const boomSecond = new Error("boom from defer second");
    const events: string[] = [];
    const op = Op(function* () {
      yield* Op.defer(() => {
        events.push("first");
      });
      yield* Op.defer(() => {
        events.push("second");
        throw boomSecond;
      });
      yield* Op.defer(() => {
        events.push("third");
      });
      yield* Op.defer(() => {
        events.push("fourth");
        throw boomFourth;
      });
      yield* Op.defer(() => {
        events.push("fifth");
        throw boomFifth;
      });
      return yield* Op.of(1);
    });
    const r = await op.run();
    assert(r.isErr(), "should be Err");
    expect(events).toEqual(["fifth", "fourth", "third", "second", "first"]);
    assert(r.error instanceof UnhandledException);
    const head = r.error.cause;
    assert(head instanceof Error);
    expect(head.message).toBe(boomFifth.message);
    const mid = head.cause;
    assert(mid instanceof Error);
    expect(mid.message).toBe(boomFourth.message);
    expect(mid.cause).toBe(boomSecond);
  });

  test("shares LIFO stack with release policy (release runs before defer registered earlier)", async () => {
    const events: string[] = [];
    const op = Op(function* () {
      yield* Op.defer(() => {
        events.push("defer");
      });
      yield* Op.of(2).with(
        Policy.release(() => {
          events.push("release");
        }),
      );
      return 3;
    });
    const r = await op.run();
    assert(r.isOk(), "should be Ok");
    expect(events).toEqual(["release", "defer"]);
  });

  test("runs Op.defer cleanup when Policy.timeout aborts inner work", async () => {
    vi.useFakeTimers();
    try {
      const cleanup = vi.fn();
      const op = Op(function* () {
        yield* Op.defer(() => cleanup());
        return yield* Op.try(
          (signal) =>
            new Promise<number>((_resolve, reject) => {
              if (signal.aborted) {
                reject(signal.reason);
                return;
              }
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
        ).with(Policy.timeout(10));
      });

      const runPromise = op.run();
      await vi.advanceTimersByTimeAsync(10);
      await vi.runOnlyPendingTimersAsync();
      const result = await runPromise;
      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Op.all([child]).with(Policy.timeout(...)) runs child Op.defer cleanup when child Op.try ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const cleanup = vi.fn();
      const child = Op(function* () {
        yield* Op.defer(() => cleanup());
        yield* Op.try(neverSettling);
      });

      const runPromise = Op.all([child]).with(Policy.timeout(10)).run();
      await vi.advanceTimersByTimeAsync(10);
      await vi.runOnlyPendingTimersAsync();
      const result = await runPromise;

      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("runs Op.defer cleanup when Policy.cancel aborts inner work", async () => {
    vi.useFakeTimers();
    try {
      const cleanup = vi.fn();
      const controller = new AbortController();
      const op = Op(function* () {
        yield* Op.defer(() => cleanup());
        return yield* Op.try(
          (signal) =>
            new Promise<number>((_resolve, reject) => {
              if (signal.aborted) {
                reject(signal.reason);
                return;
              }
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
        ).with(Policy.cancel(controller.signal));
      });

      const runPromise = op.run();
      controller.abort("cancelled");
      await vi.advanceTimersByTimeAsync(0);
      const result = await runPromise;
      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(UnhandledException);
      if (result.error instanceof UnhandledException) {
        expect(result.error.cause).toBe("cancelled");
      }
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
