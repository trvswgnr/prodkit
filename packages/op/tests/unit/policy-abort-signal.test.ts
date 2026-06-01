import { describe, expect, test, assert, vi } from "vitest";
import { _try } from "../../src/builders.js";
import { TimeoutError } from "../../src/errors.js";
import { Policy } from "../../src/policy/index.js";

describe("AbortSignal", () => {
  test("Op.try callback receives a signal that is not aborted by default", async () => {
    let seen: AbortSignal | undefined;
    const program = _try((signal) => {
      seen = signal;
      return Promise.resolve("ok");
    });
    const result = await program.run();
    assert(result.isOk(), "result should be Ok");
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
  });

  test("timeout aborts the signal passed to Op.try", async () => {
    vi.useFakeTimers();
    try {
      let seenSignal: AbortSignal | undefined;
      const program = _try(
        (signal) =>
          new Promise<number>((resolve, reject) => {
            seenSignal = signal;
            const id = setTimeout(() => resolve(69), 500);
            signal.addEventListener("abort", () => {
              clearTimeout(id);
              reject(signal.reason);
            });
          }),
      ).with(Policy.timeout(100));

      const runPromise = program.run();
      await vi.advanceTimersByTimeAsync(100);
      await vi.runOnlyPendingTimersAsync();
      const result = await runPromise;

      assert(result.isErr(), "result should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(seenSignal?.aborted).toBe(true);
      expect(seenSignal?.reason).toBeInstanceOf(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  test("timeout cascades into retry-wrapped ops so inner fetch is aborted", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      let aborted = false;

      const program = _try(
        (signal) =>
          new Promise<number>((_, reject) => {
            attempts += 1;
            const id = setTimeout(() => reject(new Error("transient")), 50);
            signal.addEventListener("abort", () => {
              aborted = true;
              clearTimeout(id);
              reject(signal.reason);
            });
          }),
      )
        .with(
          Policy.retry({
            retries: 9,
            when: () => true,
            delay: () => 10,
          }),
        )
        .with(Policy.timeout(120));

      const runPromise = program.run();
      await vi.advanceTimersByTimeAsync(200);
      await vi.runOnlyPendingTimersAsync();

      const result = await runPromise;
      assert(result.isErr(), "result should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(aborted).toBe(true);
      expect(attempts).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("timeout stops the retry loop instead of racing zombie attempts", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const transient = new Error("transient");
      const program = _try(() => {
        attempts += 1;
        return Promise.reject(transient);
      })
        .with(
          Policy.retry({
            retries: 4,
            when: () => true,
            delay: () => 1000,
          }),
        )
        .with(Policy.timeout(50));

      const runPromise = program.run();
      await vi.advanceTimersByTimeAsync(200);
      await vi.runOnlyPendingTimersAsync();

      const result = await runPromise;
      assert(result.isErr(), "result should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      // Only one attempt ran before the timeout aborted the delay and halted the loop
      expect(attempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
