import { describe, test, expect, vi } from "vitest";
import { ChildRunSession } from "../../src/core/child-run-session.js";
import { createRunContext } from "../../src/core/runtime.js";

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
});
