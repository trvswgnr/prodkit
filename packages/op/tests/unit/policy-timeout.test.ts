import { describe, expect, test, assert, vi } from "vitest";
import { _try } from "../../src/builders.js";
import { TimeoutError, UnhandledException } from "../../src/errors.js";
import { Policy } from "../../src/policy/index.js";

describe("Policy.timeout", () => {
  test("succeeds when the operation completes before timeout", async () => {
    const program = _try(() => Promise.resolve(69)).with(Policy.timeout(100));
    const result = await program.run();
    assert(result.isOk(), "result should be Ok");
    expect(result.value).toBe(69);
  });

  test("invalid negative timeout fails at run time", async () => {
    const result = await _try(() => Promise.resolve(69))
      .with(Policy.timeout(-1))
      .run();

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    if (result.error instanceof UnhandledException) {
      expect(result.error.cause).toBeInstanceOf(RangeError);
    }
  });

  test("invalid non-finite timeout fails at run time", async () => {
    const result = await _try(() => Promise.resolve(69))
      .with(Policy.timeout(Number.NaN))
      .run();

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    if (result.error instanceof UnhandledException) {
      expect(result.error.cause).toBeInstanceOf(RangeError);
    }
  });

  test("invalid timeout above platform maximum fails at run time", async () => {
    const result = await _try(() => Promise.resolve(69))
      .with(Policy.timeout(2 ** 31))
      .run();

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    if (result.error instanceof UnhandledException) {
      expect(result.error.cause).toBeInstanceOf(RangeError);
    }
  });

  test("fails with TimeoutError when operation exceeds timeout", async () => {
    vi.useFakeTimers();
    try {
      const program = _try(
        () =>
          new Promise<number>((resolve) => {
            setTimeout(() => resolve(69), 200);
          }),
      ).with(Policy.timeout(100));
      const runPromise = program.run();
      await vi.advanceTimersByTimeAsync(100);
      await vi.runOnlyPendingTimersAsync();

      const result = await runPromise;
      assert(result.isErr(), "result should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      if (result.error instanceof TimeoutError) {
        expect(result.error.timeoutMs).toBe(100);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("timeout wraps the entire retried run when chained outside retry", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const transient = new Error("transient");
      const program = _try(
        () =>
          new Promise<number>((resolve, reject) => {
            attempts += 1;
            setTimeout(() => {
              if (attempts === 1) {
                reject(transient);
                return;
              }
              resolve(69);
            }, 75);
          }),
      )
        .with(
          Policy.retry({
            retries: 2,
            when: (cause) => cause === transient,
            delay: () => 0,
          }),
        )
        .with(Policy.timeout(100));

      const runPromise = program.run();
      await vi.advanceTimersByTimeAsync(100);
      await vi.runOnlyPendingTimersAsync();

      const result = await runPromise;
      assert(result.isErr(), "result should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("timeout applies per-attempt when chained inside retry", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const program = _try(
        () =>
          new Promise<number>((resolve) => {
            attempts += 1;
            const delay = attempts === 1 ? 120 : 50;
            setTimeout(() => resolve(69), delay);
          }),
      )
        .with(Policy.timeout(100))
        .with(
          Policy.retry({
            retries: 1,
            when: (cause) => cause instanceof TimeoutError,
            delay: () => 0,
          }),
        );

      const runPromise = program.run();
      await vi.advanceTimersByTimeAsync(150);
      await vi.runOnlyPendingTimersAsync();

      const result = await runPromise;
      assert(result.isOk(), "result should be Ok");
      expect(result.value).toBe(69);
      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
