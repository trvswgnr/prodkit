import { assert, describe, expect, test, vi } from "vitest";
import { Op, TimeoutError, type ExitContext } from "../../../src/index.js";
import { ErrorGroup, UnhandledException } from "../../../src/errors.js";
import { Policy } from "../../../src/policy/index.js";
import { deferredPromise, neverSettling } from "../../support/utils.js";

describe("Op.defer error handling", () => {
  test("when op succeeds, cleanup throws: UnhandledException with cleanup ErrorGroup", async () => {
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
      expect(r.error.cause).toBeInstanceOf(ErrorGroup);
      assert(r.error.cause instanceof ErrorGroup);
      expect(r.error.cause.errors).toEqual([cleanupError]);
    }
  });

  test("when op fails, cleanup throws: ErrorGroup preserves body and cleanup failures", async () => {
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
    expect(r.error.cause).toBeInstanceOf(ErrorGroup);
    assert(r.error.cause instanceof ErrorGroup);
    expect(r.error.cause.errors).toEqual(["boom", cleanupError]);
  });

  test("unrelated runtime failures keep their UnhandledException wrapper in cleanup groups", async () => {
    const bodyFault = new Error("body failed");
    const cleanupFault = new Error("cleanup failed");
    const result = await Op(function* () {
      yield* Op.defer(() => {
        throw cleanupFault;
      });
      throw bodyFault;
    }).run();

    assert(result.isErr(), "should be Err");
    assert(result.error instanceof UnhandledException, "should be UnhandledException");
    assert(result.error.cause instanceof ErrorGroup, "cause should be ErrorGroup");
    const [bodyError, groupedCleanupFault] = result.error.cause.errors;
    assert(bodyError instanceof UnhandledException, "body error should stay wrapped");
    expect(bodyError.cause).toBe(bodyFault);
    expect(groupedCleanupFault).toBe(cleanupFault);
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
      expect(r.error.cause).toBeInstanceOf(ErrorGroup);
      assert(r.error.cause instanceof ErrorGroup);
      expect(r.error.cause.errors).toEqual([stop]);
    }
  });

  test("groups multiple cleanup throws in LIFO execution order", async () => {
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
    expect(r.error.cause).toBeInstanceOf(ErrorGroup);
    assert(r.error.cause instanceof ErrorGroup);
    expect(r.error.cause.errors).toEqual([boomFourth, boomSecond]);
  });

  test("groups only throwing cleanups among successful finalizers", async () => {
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
    expect(r.error.cause).toBeInstanceOf(ErrorGroup);
    assert(r.error.cause instanceof ErrorGroup);
    expect(r.error.cause.errors).toEqual([boomFifth, boomFourth, boomSecond]);
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

  test.each([
    {
      name: "cooperative suspended work",
      suspend: (signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    },
    {
      name: "non-cooperative suspended work",
      suspend: () => neverSettling(),
    },
  ])("preserves timeout and defer failure for $name", async ({ suspend }) => {
    vi.useFakeTimers();
    try {
      const cleanupFault = new Error("cleanup failed");
      const runPromise = Op(function* () {
        yield* Op.defer(() => {
          throw cleanupFault;
        });
        return yield* Op.try(suspend);
      })
        .with(Policy.timeout(10))
        .run();

      await vi.advanceTimersByTimeAsync(10);
      await vi.runOnlyPendingTimersAsync();
      const result = await runPromise;

      assert(result.isErr(), "should be Err");
      assert(result.error instanceof UnhandledException, "should be UnhandledException");
      assert(result.error.cause instanceof ErrorGroup, "cause should be ErrorGroup");
      expect(result.error.cause.errors[0]).toBeInstanceOf(TimeoutError);
      expect(result.error.cause.errors[1]).toBe(cleanupFault);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Policy.timeout awaits async cleanup before run settles", async () => {
    vi.useFakeTimers();
    try {
      let cleaned = false;
      const cleanupFault = new Error("cleanup failed");
      const runPromise = Op(function* () {
        yield* Op.defer(async () => {
          await Promise.resolve();
          cleaned = true;
          throw cleanupFault;
        });
        return yield* Op.try(neverSettling);
      })
        .with(Policy.timeout(10))
        .run();

      await vi.advanceTimersByTimeAsync(10);
      await vi.runOnlyPendingTimersAsync();
      const result = await runPromise;

      expect(cleaned).toBe(true);
      assert(result.isErr(), "should be Err");
      assert(result.error instanceof UnhandledException, "should be UnhandledException");
      assert(result.error.cause instanceof ErrorGroup, "cause should be ErrorGroup");
      expect(result.error.cause.errors[0]).toBeInstanceOf(TimeoutError);
      expect(result.error.cause.errors[1]).toBe(cleanupFault);
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

  test("Policy.cancel interrupts non-cooperative work and awaits async Op.defer cleanup", async () => {
    vi.useFakeTimers();
    try {
      const cleanupGate = deferredPromise<void>();
      const cleanupStarted = vi.fn();
      const controller = new AbortController();
      const abortReason = new Error("cancelled");
      let settled = false;
      const runPromise = Op(function* () {
        yield* Op.defer(async () => {
          cleanupStarted();
          await cleanupGate.promise;
        });
        yield* Op.try(neverSettling);
      })
        .with(Policy.cancel(controller.signal))
        .run();
      void runPromise.then(() => {
        settled = true;
      });

      controller.abort(abortReason);
      await vi.advanceTimersByTimeAsync(0);

      expect(cleanupStarted).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      cleanupGate.resolve();
      const result = await runPromise;

      assert(result.isErr(), "should be Err");
      assert(result.error instanceof UnhandledException, "should be UnhandledException");
      expect(result.error.cause).toBe(abortReason);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Policy.cancel cleanup group starts with the raw abort reason", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const abortReason = new Error("cancelled");
      const earlierCleanupFault = new Error("earlier cleanup failed");
      const laterCleanupFault = new Error("later cleanup failed");
      const runPromise = Op(function* () {
        yield* Op.defer(() => {
          throw earlierCleanupFault;
        });
        yield* Op.defer(() => {
          throw laterCleanupFault;
        });
        yield* Op.try(neverSettling);
      })
        .with(Policy.cancel(controller.signal))
        .run();

      controller.abort(abortReason);
      await vi.advanceTimersByTimeAsync(0);
      const result = await runPromise;

      assert(result.isErr(), "should be Err");
      assert(result.error instanceof UnhandledException, "should be UnhandledException");
      assert(result.error.cause instanceof ErrorGroup, "cause should be ErrorGroup");
      expect(result.error.cause.errors).toEqual([
        abortReason,
        laterCleanupFault,
        earlierCleanupFault,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Policy.cancel keeps a cooperative typed error first when cleanup fails", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const cleanupFault = new Error("cleanup failed");
      const runPromise = Op(function* () {
        yield* Op.defer(() => {
          throw cleanupFault;
        });
        yield* Op.try(
          (signal) =>
            new Promise<never>((_resolve, reject) => {
              if (signal.aborted) {
                reject(signal.reason);
                return;
              }
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
          () => "mapped cancellation" as const,
        );
      })
        .with(Policy.cancel(controller.signal))
        .run();

      controller.abort(new Error("cancelled"));
      await vi.advanceTimersByTimeAsync(0);
      const result = await runPromise;

      assert(result.isErr(), "should be Err");
      assert(result.error instanceof UnhandledException, "should be UnhandledException");
      assert(result.error.cause instanceof ErrorGroup, "cause should be ErrorGroup");
      expect(result.error.cause.errors).toEqual(["mapped cancellation", cleanupFault]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Policy.timeout around Policy.cancel preserves inner cleanup failure", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const cleanupFault = new Error("cleanup failed");
      const runPromise = Op(function* () {
        yield* Op.defer(async () => {
          await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 20);
          });
          throw cleanupFault;
        });
        yield* Op.try(neverSettling);
      })
        .with(Policy.cancel(controller.signal))
        .with(Policy.timeout(10))
        .run();

      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(20);
      await vi.runOnlyPendingTimersAsync();
      const result = await runPromise;

      assert(result.isErr(), "should be Err");
      assert(result.error instanceof UnhandledException, "should be UnhandledException");
      assert(result.error.cause instanceof ErrorGroup, "cause should be ErrorGroup");
      expect(result.error.cause.errors[0]).toBeInstanceOf(TimeoutError);
      expect(result.error.cause.errors[1]).toBe(cleanupFault);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Policy.cancel around Policy.timeout awaits inner cleanup failure", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const abortReason = new Error("cancelled");
      const cleanupFault = new Error("cleanup failed");
      const runPromise = Op(function* () {
        yield* Op.defer(async () => {
          await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 20);
          });
          throw cleanupFault;
        });
        yield* Op.try(neverSettling);
      })
        .with(Policy.timeout(1_000))
        .with(Policy.cancel(controller.signal))
        .run();

      controller.abort(abortReason);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(20);
      const result = await runPromise;

      assert(result.isErr(), "should be Err");
      assert(result.error instanceof UnhandledException, "should be UnhandledException");
      assert(result.error.cause instanceof ErrorGroup, "cause should be ErrorGroup");
      expect(result.error.cause.errors).toEqual([abortReason, cleanupFault]);
    } finally {
      vi.useRealTimers();
    }
  });
});
