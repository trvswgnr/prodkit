import { assert, describe, expect, test } from "vitest";
import { ErrorGroup, Op } from "../../src/index.js";
import { deferredPromise, trackAbortListeners } from "../support/utils.js";
import { Policy } from "../../src/policy/index.js";

describe("combinator abort listener cleanup", () => {
  test("pre-aborted outer signal does not leave abort listeners behind", async () => {
    const outer = new AbortController();
    outer.abort(new Error("already aborted"));
    const tracked = trackAbortListeners(outer.signal);
    try {
      await Op.all([Op.of(1), Op.of(2)])
        .with(Policy.cancel(outer.signal))
        .run();
      expect(tracked.activeAbortListeners).toBe(0);
    } finally {
      tracked.restore();
    }
  });

  test("unbounded all detaches abort listener after children settle", async () => {
    const outer = new AbortController();
    const tracked = trackAbortListeners(outer.signal);
    try {
      const r = await Op.all([Op.of(1), Op.of(2)])
        .with(Policy.cancel(outer.signal))
        .run();
      assert(r.isOk(), "should be Ok");
      expect(r.value).toEqual([1, 2]);
      expect(tracked.activeAbortListeners).toBe(0);

      outer.abort(new Error("too late"));
      expect(tracked.activeAbortListeners).toBe(0);
    } finally {
      tracked.restore();
    }
  });

  test("bounded all detaches abort listener after children settle", async () => {
    const outer = new AbortController();
    const tracked = trackAbortListeners(outer.signal);
    try {
      const r = await Op.all([Op.of(1), Op.of(2)], 1)
        .with(Policy.cancel(outer.signal))
        .run();
      assert(r.isOk(), "should be Ok");
      expect(r.value).toEqual([1, 2]);
      expect(tracked.activeAbortListeners).toBe(0);

      outer.abort(new Error("too late"));
      expect(tracked.activeAbortListeners).toBe(0);
    } finally {
      tracked.restore();
    }
  });

  test("bounded all cleans up outer abort listeners when aborted mid-flight after partial completion", async () => {
    const outer = new AbortController();
    const tracked = trackAbortListeners(outer.signal);
    const secondGate = deferredPromise<number>();
    try {
      const run = Op.all(
        [
          Op.of(1),
          Op.try(
            (signal) =>
              new Promise<number>((resolve, reject) => {
                if (signal.aborted) {
                  reject(signal.reason);
                  return;
                }
                signal.addEventListener("abort", () => reject(new Error("aborted")), {
                  once: true,
                });
                void secondGate.promise.then(resolve);
              }),
          ),
        ],
        1,
      )
        .with(Policy.cancel(outer.signal))
        .run();

      await Promise.resolve();
      outer.abort(new Error("cancel"));

      const r = await run;
      assert(r.isErr(), "should be Err");
      expect(tracked.activeAbortListeners).toBe(0);
    } finally {
      tracked.restore();
      secondGate.resolve(2);
    }
  });

  test("any cleans up outer abort listeners when aborted mid-flight after partial completion", async () => {
    const outer = new AbortController();
    const tracked = trackAbortListeners(outer.signal);
    try {
      const run = Op.any([
        Op.fail("fast-fail"),
        Op.try(
          (signal) =>
            new Promise<never>((_, reject) =>
              signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
            ),
        ),
      ])
        .with(Policy.cancel(outer.signal))
        .run();

      await Promise.resolve();
      outer.abort(new Error("cancel"));

      const r = await run;
      assert(r.isErr(), "should be Err");
      assert(ErrorGroup.is(r.error), "should be ErrorGroup");
      expect(r.error.errors.length).toBeGreaterThan(0);
      expect(tracked.activeAbortListeners).toBe(0);
    } finally {
      tracked.restore();
    }
  });
});
