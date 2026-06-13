import { describe, test, expect, vi } from "vitest";
import { ChildRunSession } from "../../../src/execution/child-run-session.js";
import { createRunContext } from "../../../src/execution/runtime.js";
import { TimeoutError, UnhandledException } from "../../../src/errors.js";
import { Result } from "../../../src/result.js";
import { neverSettling, settleOutcome } from "../../support/utils.js";

describe("ChildRunSession", () => {
  test("isolated cascades parent abort reason to the child signal", () => {
    const parent = new AbortController();
    const parentContext = createRunContext(parent.signal);
    const session = ChildRunSession.isolated(parentContext);
    const onAbort = vi.fn();

    session.signal.addEventListener("abort", onAbort);
    parent.abort("parent-cancelled");

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(session.signal.reason).toBe("parent-cancelled");
  });

  test("isolated detach removes the parent abort listener", () => {
    const parent = new AbortController();
    const parentContext = createRunContext(parent.signal);
    const session = ChildRunSession.isolated(parentContext);
    const onAbort = vi.fn();

    session.signal.addEventListener("abort", onAbort);
    session.detach();
    parent.abort("late");

    expect(onAbort).not.toHaveBeenCalled();
  });

  test("pool cascades parent abort to every active child controller", () => {
    const parent = new AbortController();
    const parentContext = createRunContext(parent.signal);
    const session = ChildRunSession.pool(parentContext);
    const slots = Array.from({ length: 3 }, () => session.spawn());
    const reasons = slots.map((slot) => {
      const onAbort = vi.fn();
      slot.signal.addEventListener("abort", onAbort);
      return { onAbort, slot };
    });

    parent.abort("fan-out-cancelled");

    for (const { onAbort, slot } of reasons) {
      expect(onAbort).toHaveBeenCalledTimes(1);
      expect(slot.signal.reason).toBe("fan-out-cancelled");
    }

    for (const slot of slots) slot.release();
    session.detach();
  });

  test("pool spawn aborts immediately when the parent is already aborted", () => {
    const parent = new AbortController();
    parent.abort("already-done");
    const parentContext = createRunContext(parent.signal);
    const session = ChildRunSession.pool(parentContext);

    const slot = session.spawn();

    expect(slot.signal.aborted).toBe(true);
    expect(slot.signal.reason).toBe("already-done");
    slot.release();
    session.detach();
  });

  test("boundCancel merges bound and outer abort into one child signal", async () => {
    const bound = new AbortController();
    const outer = new AbortController();
    const outerContext = createRunContext(outer.signal);
    const session = ChildRunSession.boundCancel(bound.signal, outerContext);
    const onAbort = vi.fn();

    session.signal.addEventListener("abort", onAbort);
    bound.abort("bound-cancelled");

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(session.signal.reason).toBe("bound-cancelled");
    await expect(session.boundAbort).resolves.toBeUndefined();
    session.detach();
  });

  test("boundCancel cascades outer abort with the outer reason", () => {
    const bound = new AbortController();
    const outer = new AbortController();
    const outerContext = createRunContext(outer.signal);
    const session = ChildRunSession.boundCancel(bound.signal, outerContext);
    const onAbort = vi.fn();

    session.signal.addEventListener("abort", onAbort);
    outer.abort("outer-cancelled");

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(session.signal.reason).toBe("outer-cancelled");
    session.detach();
  });

  test("raceBoundCancel settles when child work ignores abort", async () => {
    const bound = new AbortController();
    const outerContext = createRunContext(new AbortController().signal);
    const abortReason = new Error("request cancelled");

    const runPromise = ChildRunSession.raceBoundCancel(
      async () => {
        await neverSettling();
        return Result.ok(69);
      },
      bound.signal,
      outerContext,
    );
    bound.abort(abortReason);

    expect(await settleOutcome(runPromise)).toBe("settled");
    const result = await runPromise;
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(UnhandledException);
      if (result.error instanceof UnhandledException) {
        expect(result.error.cause).toBe(abortReason);
      }
    }
  });

  test("raceTimeout returns TimeoutError after draining slower in-flight work", async () => {
    vi.useFakeTimers();
    try {
      const outerContext = createRunContext(new AbortController().signal);

      const runPromise = ChildRunSession.raceTimeout(
        async () => {
          await new Promise<number>((resolve) => {
            setTimeout(() => resolve(69), 100);
          });
          return Result.ok(69);
        },
        50,
        outerContext,
      );
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);
      await vi.runOnlyPendingTimersAsync();

      const result = await runPromise;
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(TimeoutError);
        if (result.error instanceof TimeoutError) {
          expect(result.error.timeoutMs).toBe(50);
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
