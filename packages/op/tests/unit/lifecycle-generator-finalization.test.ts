import { assert, describe, expect, test, vi } from "vitest";
import { Op, TimeoutError } from "../../src/index.js";
import { UnhandledException } from "../../src/errors.js";
import { SuspendInstruction, SuspendResume } from "../../src/core/instructions.js";
import { Policy } from "../../src/policy/index.js";

describe("generator finalization on early exit", () => {
  test("runs finally when the body yields an Err instruction", async () => {
    const events: string[] = [];
    const program = Op(function* () {
      try {
        events.push("start");
        yield* Op.fail("boom");
        return "unreachable";
      } finally {
        events.push("finally");
      }
    });

    const result = await program.run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBe("boom");
    expect(events).toEqual(["start", "finally"]);
  });

  test("runs finally when a suspended instruction throws", async () => {
    const events: string[] = [];
    const cause = new Error("suspend failed");
    const program = Op(function* () {
      try {
        events.push("start");
        yield new SuspendInstruction(async () => {
          throw cause;
        }, SuspendResume.passThrough);
        return 1;
      } finally {
        events.push("finally");
      }
    });

    const result = await program.run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    expect(result.error.cause).toBe(cause);
    expect(events).toEqual(["start", "finally"]);
  });

  test("runs finally when Policy.timeout aborts inner work", async () => {
    vi.useFakeTimers();
    try {
      let finalized = false;
      const program = Op(function* () {
        try {
          yield* Op.try(
            (signal) =>
              new Promise<number>((_resolve, reject) => {
                if (signal.aborted) {
                  reject(signal.reason);
                  return;
                }
                signal.addEventListener("abort", () => reject(signal.reason), { once: true });
              }),
          ).with(Policy.timeout(10));
          return 1;
        } finally {
          finalized = true;
        }
      });

      const runPromise = program.run();
      await vi.advanceTimersByTimeAsync(10);
      await vi.runOnlyPendingTimersAsync();
      const result = await runPromise;

      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(finalized).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("preserves original Err result when cleanup throws during iter.return()", async () => {
    const cleanupFault = new Error("cleanup failed");
    const failCleanup = () => {
      throw cleanupFault;
    };
    const program = Op(function* () {
      try {
        yield* Op.fail("boom");
        return "unreachable";
      } finally {
        failCleanup();
      }
    });

    const result = await program.run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBe("boom");
  });

  test("does not drive yield* Op.defer registered in finally after early Err", async () => {
    let deferRan = false;
    const events: string[] = [];
    const program = Op(function* () {
      try {
        events.push("start");
        yield* Op.fail("boom");
        return "unreachable";
      } finally {
        events.push("finally-sync");
        yield* Op.defer(() => {
          deferRan = true;
        });
      }
    });

    const result = await program.run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBe("boom");
    expect(events).toEqual(["start", "finally-sync"]);
    expect(deferRan).toBe(false);
  });
});
