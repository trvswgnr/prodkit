import { assert, describe, expect, test, vi } from "vitest";
import { Op } from "../../src/index.js";
import { TaggedError, UnhandledException } from "../../src/errors.js";
import { deferredPromise, invalidConcurrencies, TRUE } from "../support/utils.js";

describe("Op.all", () => {
  test("tuple of successes in input order", async () => {
    const r = await Op.all([Op.of(1), Op.of("two"), Op.of(true)]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toEqual([1, "two", true]);
  });

  test("empty input succeeds with []", async () => {
    const r = await Op.all([]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toEqual([]);
  });

  test.each(invalidConcurrencies)(
    "invalid concurrency %s returns UnhandledException",
    async (concurrency) => {
      const r = await Op.all([Op.of(1)], concurrency).run();
      assert(r.isErr(), "should be Err");
      expect(r.error).toBeInstanceOf(UnhandledException);
      expect(r.error.cause).toEqual(new RangeError("concurrency must be a positive integer"));
    },
  );

  test("fails fast on first Err and aborts siblings", async () => {
    let siblingAborted = false;
    const slow = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          const t = setTimeout(() => resolve(1), 50);
          signal.addEventListener("abort", () => {
            siblingAborted = true;
            clearTimeout(t);
            resolve(-1);
          });
        }),
    );
    const fast = Op.fail("boom");

    const r = await Op.all([slow, fast]).run();
    assert(r.isErr(), "should be Err");
    expect(r.error).toBe("boom");
    expect(siblingAborted).toBe(true);
  });

  test("union error type across children", async () => {
    class AErr extends TaggedError("AErr")() {}
    class BErr extends TaggedError("BErr")() {}
    const n: number = 1;
    const s: string = "x";
    const a = Op(function* () {
      if (TRUE) return yield* new AErr();
      return n;
    });
    const b = Op(function* () {
      if (TRUE) return yield* new BErr();
      return s;
    });
    const combined = Op.all([a, b]);
    const r = await combined.run();
    assert(r.isErr(), "should be Err");
    expect(r.error).toBeInstanceOf(AErr);
  });

  test("awaits every child before returning after a failure", async () => {
    let slowObservedAbort = false;
    const slow = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          signal.addEventListener("abort", () => {
            slowObservedAbort = true;
            setTimeout(() => resolve(-1), 5);
          });
        }),
    );
    const fast = Op.fail("boom");
    await Op.all([slow, fast]).run();
    expect(slowObservedAbort).toBe(true);
  });

  test("limits active children while preserving input order", async () => {
    const firstGate = deferredPromise<number>();
    const secondGate = deferredPromise<number>();
    const thirdGate = deferredPromise<number>();
    const fourthGate = deferredPromise<number>();
    const gates = [firstGate, secondGate, thirdGate, fourthGate];
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const ops = gates.map((gate, i) =>
      Op.try(async () => {
        started.push(i);
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          return await gate.promise;
        } finally {
          active -= 1;
        }
      }),
    );

    const run = Op.all(ops, 2).run();
    await Promise.resolve();

    expect(started).toEqual([0, 1]);
    expect(maxActive).toBe(2);

    secondGate.resolve(1);
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    expect(active).toBe(2);

    firstGate.resolve(0);
    thirdGate.resolve(2);
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));

    fourthGate.resolve(3);
    const r = await run;

    assert(r.isOk(), "should be Ok");
    expect(r.value).toEqual([0, 1, 2, 3]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  test("does not start queued children after bounded failure", async () => {
    let slowObservedAbort = false;
    let queuedStarted = false;
    const slow = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          signal.addEventListener("abort", () => {
            slowObservedAbort = true;
            resolve(-1);
          });
        }),
    );
    const fast = Op.fail("boom");
    const queued = Op.try(() => {
      queuedStarted = true;
      return 3;
    });

    const r = await Op.all([slow, fast, queued], 2).run();

    assert(r.isErr(), "should be Err");
    expect(r.error).toBe("boom");
    expect(slowObservedAbort).toBe(true);
    expect(queuedStarted).toBe(false);
  });

  test("unbounded mode preserves undefined as first error", async () => {
    const r = await Op.all([Op.fail(undefined), Op.of(1)]).run();
    assert(r.isErr(), "should be Err");
    expect(r.error).toBeUndefined();
  });

  test("bounded mode preserves undefined as first error", async () => {
    const r = await Op.all([Op.fail(undefined), Op.of(1)], 1).run();
    assert(r.isErr(), "should be Err");
    expect(r.error).toBeUndefined();
  });
});
