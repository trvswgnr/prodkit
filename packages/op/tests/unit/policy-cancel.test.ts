import { describe, expect, test, assert, vi } from "vitest";
import { _try } from "../../src/builders.js";
import { UnhandledException } from "../../src/errors.js";
import { Policy } from "../../src/policy/index.js";
import { neverSettling, settleOutcome } from "../support/utils.js";

describe("Policy.cancel", () => {
  test("passes a live signal into Op.try by default", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const program = _try((signal) => {
      seenSignal = signal;
      return Promise.resolve(69);
    }).with(Policy.cancel(controller.signal));

    const result = await program.run();
    assert(result.isOk(), "result should be Ok");
    expect(result.value).toBe(69);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(false);
  });

  test("aborting the bound signal cancels in-flight Op.try work", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const program = _try(
        (signal) =>
          new Promise<number>((resolve, reject) => {
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            const id = setTimeout(() => resolve(69), 500);
            signal.addEventListener("abort", () => {
              clearTimeout(id);
              reject(signal.reason);
            });
          }),
        (cause) => String(cause instanceof Error ? cause.message : cause),
      ).with(Policy.cancel(controller.signal));

      const runPromise = program.run();
      controller.abort(new Error("request cancelled"));
      await vi.advanceTimersByTimeAsync(0);

      const result = await runPromise;
      assert(result.isErr(), "result should be Err");
      expect(result.error).toBe("request cancelled");
    } finally {
      vi.useRealTimers();
    }
  });

  test("Policy.cancel settles when inner Op.try ignores abort", async () => {
    const controller = new AbortController();
    const abortReason = new Error("request cancelled");
    const program = _try(neverSettling).with(Policy.cancel(controller.signal));

    const runPromise = program.run();
    controller.abort(abortReason);

    expect(await settleOutcome(runPromise)).toBe("settled");
    const result = await runPromise;
    assert(result.isErr(), "result should be Err");
    assert(result.error instanceof UnhandledException);
    expect(result.error.cause).toBe(abortReason);
  });
});
