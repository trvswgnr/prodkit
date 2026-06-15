import { assert, describe, expect, test, vi } from "vitest";
import {
  createFanOutChildren,
  runWithBoundCancel,
  runWithTimeout,
} from "../../../src/execution/child-run.js";
import { SuspendInstruction } from "../../../src/execution/instructions.js";
import { createRunContext } from "../../../src/execution/runtime.js";
import { Settlement } from "../../../src/execution/settlement.js";
import {
  CLEANUP_FAILURE_MESSAGE,
  ErrorGroup,
  TimeoutError,
  UnhandledException,
} from "../../../src/errors.js";
import { createPlan } from "../../../src/plan/model.js";
import { Result } from "../../../src/result.js";
import { neverSettling, settleOutcome, trackAbortListeners } from "../../support/utils.js";

describe("child runs", () => {
  test("fan-out children cascade the parent abort reason", () => {
    const parent = new AbortController();
    const parentContext = createRunContext(parent.signal);
    const children = createFanOutChildren(parentContext);
    const child = children.spawn();
    const onAbort = vi.fn();

    child.context.signal.addEventListener("abort", onAbort);
    parent.abort("parent-cancelled");

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(child.context.signal.reason).toBe("parent-cancelled");
    child.release();
    children.detach();
  });

  test("fan-out detach removes the parent abort listener", () => {
    const parent = new AbortController();
    const parentContext = createRunContext(parent.signal);
    const children = createFanOutChildren(parentContext);
    const child = children.spawn();
    const onAbort = vi.fn();

    child.context.signal.addEventListener("abort", onAbort);
    children.detach();
    parent.abort("late");

    expect(onAbort).not.toHaveBeenCalled();
    child.release();
  });

  test("fan-out abortActive aborts every active child", () => {
    const parent = new AbortController();
    const parentContext = createRunContext(parent.signal);
    const children = createFanOutChildren(parentContext);
    const active = Array.from({ length: 3 }, () => children.spawn());
    const reasons = active.map((child) => {
      const onAbort = vi.fn();
      child.context.signal.addEventListener("abort", onAbort);
      return { child, onAbort };
    });

    children.abortActive("fan-out-cancelled");

    for (const { child, onAbort } of reasons) {
      expect(onAbort).toHaveBeenCalledTimes(1);
      expect(child.context.signal.reason).toBe("fan-out-cancelled");
    }

    for (const child of active) child.release();
    children.detach();
  });

  test("fan-out spawn aborts immediately when the parent is already aborted", () => {
    const parent = new AbortController();
    parent.abort("already-done");
    const parentContext = createRunContext(parent.signal);
    const children = createFanOutChildren(parentContext);

    const child = children.spawn();

    expect(child.context.signal.aborted).toBe(true);
    expect(child.context.signal.reason).toBe("already-done");
    child.release();
    children.detach();
  });

  test("runWithBoundCancel passes the bound abort reason to child work", async () => {
    const bound = new AbortController();
    const outer = new AbortController();
    const outerContext = createRunContext(outer.signal);
    const runPromise = runWithBoundCancel(
      (context) =>
        new Promise<Result<unknown, never>>((resolve) => {
          context.signal.addEventListener(
            "abort",
            () => resolve(Result.ok(context.signal.reason)),
            { once: true },
          );
        }),
      bound.signal,
      outerContext,
    );

    bound.abort("bound-cancelled");

    await expect(runPromise).resolves.toEqual(Result.ok("bound-cancelled"));
  });

  test("runWithBoundCancel skips launch for a pre-aborted bound signal", async () => {
    const bound = new AbortController();
    const outer = new AbortController();
    const abortReason = new Error("already cancelled");
    bound.abort(abortReason);
    const trackedBound = trackAbortListeners(bound.signal);
    const trackedOuter = trackAbortListeners(outer.signal);
    const run = vi.fn(async () => Result.ok(69));
    try {
      const result = await runWithBoundCancel(run, bound.signal, createRunContext(outer.signal));

      assert(result.isErr(), "result should be Err");
      assert(result.error instanceof UnhandledException, "should be UnhandledException");
      expect(result.error.cause).toBe(abortReason);
      expect(run).not.toHaveBeenCalled();
      expect(trackedBound.activeAbortListeners).toBe(0);
      expect(trackedOuter.activeAbortListeners).toBe(0);
    } finally {
      trackedBound.restore();
      trackedOuter.restore();
    }
  });

  test("runWithBoundCancel passes the outer abort reason to child work", async () => {
    const bound = new AbortController();
    const outer = new AbortController();
    const outerContext = createRunContext(outer.signal);
    const runPromise = runWithBoundCancel(
      (context) =>
        new Promise<Result<unknown, never>>((resolve) => {
          context.signal.addEventListener(
            "abort",
            () => resolve(Result.ok(context.signal.reason)),
            { once: true },
          );
        }),
      bound.signal,
      outerContext,
    );

    outer.abort("outer-cancelled");

    await expect(runPromise).resolves.toEqual(Result.ok("outer-cancelled"));
  });

  test("runWithBoundCancel settles when child work ignores abort", async () => {
    const bound = new AbortController();
    const outer = new AbortController();
    const trackedBound = trackAbortListeners(bound.signal);
    const trackedOuter = trackAbortListeners(outer.signal);
    const outerContext = createRunContext(outer.signal);
    const abortReason = new Error("request cancelled");
    const source = createPlan(function* () {
      yield* new SuspendInstruction(neverSettling);
      return 69;
    });

    try {
      const runPromise = runWithBoundCancel(
        (context) => Settlement.interrupting.runPlan(source, context),
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
      expect(trackedBound.activeAbortListeners).toBe(0);
      expect(trackedOuter.activeAbortListeners).toBe(0);
    } finally {
      trackedBound.restore();
      trackedOuter.restore();
    }
  });

  test("runWithTimeout cascades outer abort to child work", async () => {
    const outer = new AbortController();
    const outerContext = createRunContext(outer.signal);
    const runPromise = runWithTimeout(
      (context) =>
        new Promise<Result<unknown, never>>((resolve) => {
          context.signal.addEventListener(
            "abort",
            () => resolve(Result.ok(context.signal.reason)),
            { once: true },
          );
        }),
      1_000,
      outerContext,
    );

    outer.abort("outer-cancelled");

    await expect(runPromise).resolves.toEqual(Result.ok("outer-cancelled"));
  });

  test("runWithTimeout returns TimeoutError after draining slower in-flight work", async () => {
    vi.useFakeTimers();
    try {
      const outerContext = createRunContext(new AbortController().signal);

      const runPromise = runWithTimeout(
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

  test("runWithTimeout preserves cleanup failures from the drained child run", async () => {
    vi.useFakeTimers();
    try {
      const laterCleanupFault = new Error("later cleanup failed");
      const earlierCleanupFault = new Error("earlier cleanup failed");
      const outerContext = createRunContext(new AbortController().signal);

      const runPromise = runWithTimeout(
        (context) =>
          new Promise<Result<never, UnhandledException>>((resolve) => {
            context.signal.addEventListener(
              "abort",
              () => {
                const interrupted = new UnhandledException({ cause: context.signal.reason });
                resolve(
                  Result.err(
                    new UnhandledException({
                      cause: new ErrorGroup(
                        [interrupted, laterCleanupFault, earlierCleanupFault],
                        CLEANUP_FAILURE_MESSAGE,
                      ),
                    }),
                  ),
                );
              },
              { once: true },
            );
          }),
        50,
        outerContext,
      );

      await vi.advanceTimersByTimeAsync(50);
      const result = await runPromise;

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(UnhandledException);
        if (result.error instanceof UnhandledException) {
          expect(result.error.cause).toBeInstanceOf(ErrorGroup);
          if (result.error.cause instanceof ErrorGroup) {
            expect(result.error.cause.errors[0]).toBeInstanceOf(TimeoutError);
            expect(result.error.cause.errors[1]).toBe(laterCleanupFault);
            expect(result.error.cause.errors[2]).toBe(earlierCleanupFault);
          }
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("runWithTimeout preserves cleanup failures when drained group lacks a timeout interruption", async () => {
    vi.useFakeTimers();
    try {
      const cleanupFault = new Error("cleanup failed");
      const outerContext = createRunContext(new AbortController().signal);

      const runPromise = runWithTimeout(
        async () => {
          await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 100);
          });
          return Result.err(
            new UnhandledException({
              cause: new ErrorGroup([cleanupFault], CLEANUP_FAILURE_MESSAGE),
            }),
          );
        },
        50,
        outerContext,
      );

      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);
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

  test("runWithTimeout prepends TimeoutError when drained group leads with a non-timeout body error", async () => {
    vi.useFakeTimers();
    try {
      const domainError = "domain";
      const cleanupFault = new Error("cleanup failed");
      const outerContext = createRunContext(new AbortController().signal);

      const runPromise = runWithTimeout(
        async () => {
          await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 100);
          });
          return Result.err(
            new UnhandledException({
              cause: new ErrorGroup([domainError, cleanupFault], CLEANUP_FAILURE_MESSAGE),
            }),
          );
        },
        50,
        outerContext,
      );

      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);
      await vi.runOnlyPendingTimersAsync();
      const result = await runPromise;

      assert(result.isErr(), "should be Err");
      assert(result.error instanceof UnhandledException, "should be UnhandledException");
      assert(result.error.cause instanceof ErrorGroup, "cause should be ErrorGroup");
      expect(result.error.cause.errors[0]).toBeInstanceOf(TimeoutError);
      expect(result.error.cause.errors[1]).toBe(domainError);
      expect(result.error.cause.errors[2]).toBe(cleanupFault);
    } finally {
      vi.useRealTimers();
    }
  });
});
