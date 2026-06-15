import { assert, describe, expect, test, vi } from "vitest";
import { Op, TimeoutError } from "../../../src/index.js";
import { ErrorGroup, UnhandledException } from "../../../src/errors.js";
import { Policy } from "../../../src/policy/index.js";
import { deferredPromise, neverSettling } from "../../support/utils.js";

describe("op.with(Policy.release(...))", () => {
  test("runs registered cleanup after a successful run", async () => {
    const events: string[] = [];
    const release = vi.fn((conn: { id: number }) => {
      events.push(`release:${conn.id}`);
    });

    const program = Op(function* () {
      const conn = yield* Op.of({ id: 7 }).with(Policy.release(release));
      events.push(`query:${conn.id}`);
      return conn.id;
    });

    const result = await program.run();
    assert(result.isOk(), "should be Ok");
    expect(result.value).toBe(7);
    expect(events).toEqual(["query:7", "release:7"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("runs cleanup when downstream logic fails with a typed error", async () => {
    const release = vi.fn();
    const result = await Op(function* () {
      yield* Op.of({ id: 1 }).with(
        Policy.release(() => {
          release();
        }),
      );
      return yield* Op.fail("boom" as const);
    }).run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBe("boom");
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("runs cleanup when Policy.timeout aborts inner work", async () => {
    vi.useFakeTimers();
    try {
      const release = vi.fn();
      const op = Op(function* () {
        yield* Op.of({ close: release }).with(Policy.release((conn) => conn.close()));
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
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Policy.timeout waits for async release cleanup before run settles", async () => {
    vi.useFakeTimers();
    try {
      let released = false;
      let settled = false;
      const op = Op(function* () {
        yield* Op.of({
          close: async () => {
            await new Promise<void>((resolve) => {
              setTimeout(() => {
                released = true;
                resolve();
              }, 20);
            });
          },
        }).with(Policy.release((conn) => conn.close()));

        return yield* Op.try(
          (signal) =>
            new Promise<number>((_resolve, reject) => {
              if (signal.aborted) {
                reject(signal.reason);
                return;
              }
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
        );
      }).with(Policy.timeout(10));

      const runPromise = op.run();
      void runPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(10);
      // Yield one microtask so timeout teardown can start without assuming .run() is still
      // synchronous after advanceTimersByTimeAsync; release cleanup is on a later timer.
      await Promise.resolve();

      expect(settled).toBe(false);
      expect(released).toBe(false);

      await vi.advanceTimersByTimeAsync(20);

      const result = await runPromise;
      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(released).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Policy.timeout preserves a throwing registered release cleanup", async () => {
    vi.useFakeTimers();
    try {
      const cleanupFault = new Error("cleanup failed");
      const runPromise = Op(function* () {
        yield* Op.of("resource").with(
          Policy.release(() => {
            throw cleanupFault;
          }),
        );
        return yield* Op.try(() => new Promise<never>(() => {}));
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

  test("Policy.cancel awaits a release registered before later cancellation", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const releaseGate = deferredPromise<void>();
      const releaseStarted = vi.fn();
      let settled = false;
      const runPromise = Op(function* () {
        yield* Op.of("resource").with(
          Policy.release(async () => {
            releaseStarted();
            await releaseGate.promise;
          }),
        );
        yield* Op.try(neverSettling);
      })
        .with(Policy.cancel(controller.signal))
        .run();
      void runPromise.then(() => {
        settled = true;
      });

      controller.abort(new Error("cancelled"));
      await vi.advanceTimersByTimeAsync(0);

      expect(releaseStarted).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      releaseGate.resolve();
      await runPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  test("Policy.cancel does not register release before the wrapped operation succeeds", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const release = vi.fn();
      const runPromise = Op(function* () {
        yield* Op.try(neverSettling).with(Policy.release(release));
      })
        .with(Policy.cancel(controller.signal))
        .run();

      controller.abort(new Error("cancelled"));
      await vi.advanceTimersByTimeAsync(0);
      await runPromise;

      expect(release).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("Policy.cancel groups the raw abort reason before a registered release fault", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const abortReason = new Error("cancelled");
      const releaseFault = new Error("release failed");
      const runPromise = Op(function* () {
        yield* Op.of("resource").with(
          Policy.release(() => {
            throw releaseFault;
          }),
        );
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
      expect(result.error.cause.errors).toEqual([abortReason, releaseFault]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("fails with UnhandledException when cleanup throws after success", async () => {
    const cleanupFault = new Error("cleanup failed");
    const result = await Op.of(1)
      .with(
        Policy.release(() => {
          throw cleanupFault;
        }),
      )
      .run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    if (result.error instanceof UnhandledException) {
      expect(result.error.cause).toBeInstanceOf(ErrorGroup);
      assert(result.error.cause instanceof ErrorGroup);
      expect(result.error.cause.errors).toEqual([cleanupFault]);
    }
  });

  test("preserves primary error when cleanup throws after typed failure", async () => {
    const result = await Op.fail("boom" as const)
      .with(
        Policy.release(() => {
          throw new Error("cleanup failed");
        }),
      )
      .run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBe("boom");
  });

  test("preserves inferred op shapes", async () => {
    const p1 = Op.of({ id: 1 }).with(Policy.release((_value) => {}));
    const p2 = Op(function* (name: string) {
      return name.length;
    }).with(Policy.release((_len) => {}));

    expect((await p1.run()).isOk()).toBe(true);
    expect((await p2.run("abc")).isOk()).toBe(true);
  });
});
