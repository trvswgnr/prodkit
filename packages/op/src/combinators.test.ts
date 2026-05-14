import { assert, describe, expect, test, vi } from "vitest";
import { ErrorGroup, Op } from "./index.js";
import { TaggedError, TimeoutError, UnhandledException } from "./errors.js";
import {
  deferredPromise,
  invalidConcurrencies,
  rejectAfter,
  resolveAfter,
  trackAbortListeners,
  TRUE,
} from "./test-utils.js";

const alwaysTrue: boolean = true;

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
    const fast = Op.fail("boom" as const);

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
      if (alwaysTrue) return yield* new AErr();
      return n;
    });
    const b = Op(function* () {
      if (alwaysTrue) return yield* new BErr();
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
    const fast = Op.fail("boom" as const);
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
    const fast = Op.fail("boom" as const);
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

describe("Op.allSettled", () => {
  test("returns tuple of Result in input order", async () => {
    const r = await Op.allSettled([Op.of(1), Op.fail("no" as const), Op.of("ok")]).run();
    assert(r.isOk(), "should be Ok");
    const [a, b, c] = r.value;
    assert(a.isOk() && b.isErr() && c.isOk(), "branches should be Ok, Err, Ok");
    expect(a.value).toBe(1);
    expect(b.error).toBe("no");
    expect(c.value).toBe("ok");
  });

  test("empty input succeeds with []", async () => {
    const r = await Op.allSettled([]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toEqual([]);
  });

  test.each(invalidConcurrencies)(
    "invalid concurrency %s returns UnhandledException",
    async (concurrency) => {
      const r = await Op.allSettled([Op.of(1)], concurrency).run();
      assert(r.isErr(), "should be Err");
      expect(r.error).toBeInstanceOf(UnhandledException);
      expect(r.error.cause).toEqual(new RangeError("concurrency must be a positive integer"));
    },
  );

  test("never fails", async () => {
    const combined = Op.allSettled([Op.fail(1), Op.fail("two" as const)]);
    const r = await combined.run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toHaveLength(2);
  });

  test("does not abort siblings on failure", async () => {
    let siblingAborted = false;
    const slow = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          const t = setTimeout(() => resolve(1), 10);
          signal.addEventListener("abort", () => {
            siblingAborted = true;
            clearTimeout(t);
            resolve(-1);
          });
        }),
    );
    const r = await Op.allSettled([slow, Op.fail("boom")]).run();
    assert(r.isOk(), "should be Ok");
    expect(siblingAborted).toBe(false);
    const [first] = r.value;
    assert(first.isOk(), "first should be Ok");
    expect(first.value).toBe(1);
  });

  test("limits active children and keeps draining after failures", async () => {
    const started: number[] = [];
    const first = Op(function* () {
      started.push(0);
      return yield* Op.fail("boom" as const);
    });
    const second = Op(function* () {
      started.push(1);
      return yield* Op.of("ok" as const);
    });

    const r = await Op.allSettled([first, second], 1).run();

    assert(r.isOk(), "should be Ok");
    expect(started).toEqual([0, 1]);
    const [a, b] = r.value;
    assert(a.isErr() && b.isOk(), "branches should be Err, Ok");
    expect(a.error).toBe("boom");
    expect(b.value).toBe("ok");
  });
});

describe("Op.settle", () => {
  test("wraps success in a settled Result", async () => {
    const r = await Op.settle(Op.of(69)).run();
    assert(r.isOk(), "should be Ok");
    const settled = r.value;
    assert(settled.isOk(), "should be Ok");
    expect(settled.value).toBe(69);
  });

  test("wraps failure in a settled Result", async () => {
    const r = await Op.settle(Op.fail("nope" as const)).run();
    assert(r.isOk(), "should be Ok");
    const settled = r.value;
    assert(settled.isErr(), "should be Err");
    expect(settled.error).toBe("nope");
  });

  test("preserves child result typing", async () => {
    const combined = Op.settle(Op.fail(1));
    const r = await combined.run();
    assert(r.isOk(), "should be Ok");
    expect(r.value.isErr()).toBe(true);
  });
});

describe("Op.any", () => {
  test("returns first success and aborts siblings", async () => {
    let slowAborted = false;
    const slow = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          const t = setTimeout(() => resolve(99), 50);
          signal.addEventListener("abort", () => {
            slowAborted = true;
            clearTimeout(t);
            resolve(-1);
          });
        }),
    );
    const r = await Op.any([slow, Op.of(69)]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(69);
    expect(slowAborted).toBe(true);
  });

  test("first success can be undefined", async () => {
    const r = await Op.any([Op.of(undefined), Op.of(1)]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBeUndefined();
  });

  test("all-fail surfaces ErrorGroup with errors in input order", async () => {
    const r = await Op.any([
      Op.fail("a" as const),
      Op.fail("b" as const),
      Op.fail("c" as const),
    ]).run();
    assert(r.isErr(), "should be Err");
    assert(ErrorGroup.is(r.error), "should be ErrorGroup");
    expect(r.error.errors).toEqual(["a", "b", "c"]);
  });

  test("empty input fails with empty ErrorGroup", async () => {
    const r = await Op.any([]).run();
    assert(r.isErr(), "should be Err");
    assert(ErrorGroup.is(r.error), "should be ErrorGroup");
    expect(r.error.errors).toEqual([]);
  });

  test("error type is ErrorGroup<union of child errors>", async () => {
    const combined = Op.any([Op.fail(1), Op.fail("two" as const)]);
    const r = await combined.run();
    assert(r.isErr(), "should be Err");
    assert(ErrorGroup.is(r.error), "should be ErrorGroup");
    expect(r.error.errors).toEqual([1, "two"]);
  });

  test("preserves index order when failures settle out of order", async () => {
    const toTag =
      <T extends string>(tag: T) =>
      (_: unknown): T =>
        tag;
    const r = await Op.any([
      Op.try(() => rejectAfter("slow", 10), toTag("slow")),
      Op.try(() => rejectAfter("fast", 0), toTag("fast")),
    ]).run();
    assert(r.isErr(), "should be Err");
    assert(ErrorGroup.is(r.error), "ErrorGroup");
    expect(r.error.errors).toEqual(["slow", "fast"]);
  });

  test("waits for loser finalization before returning the winner", async () => {
    const loserCleanupGate = deferredPromise<void>();
    let loserSawAbort = false;
    const loser = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              loserSawAbort = true;
              loserCleanupGate.promise.then(() => resolve(-1));
            },
            { once: true },
          );
        }),
    );

    const run = Op.any([loser, Op.of(7)]).run();
    let settled = false;
    run.then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(loserSawAbort).toBe(true));
    expect(settled).toBe(false);

    loserCleanupGate.resolve();
    const r = await run;

    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(7);
  });

  test("winner success keeps precedence over loser abort-time failures", async () => {
    const loser = Op.try(
      (signal) =>
        new Promise<number>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject("cleanup-failed" as const);
            },
            { once: true },
          );
        }),
      (cause) => cause as "cleanup-failed",
    );

    const r = await Op.any([loser, Op.of(1)]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(1);
  });
});

describe("Op.race", () => {
  test("first settler wins (Ok)", async () => {
    let loserAborted = false;
    const slow = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          const t = setTimeout(() => resolve(-1), 50);
          signal.addEventListener("abort", () => {
            loserAborted = true;
            clearTimeout(t);
            resolve(-1);
          });
        }),
    );
    const fast = Op.try(() => resolveAfter(7, 0));
    const r = await Op.race([slow, fast]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(7);
    expect(loserAborted).toBe(true);
  });

  test("first settler wins (Err)", async () => {
    const slow = Op.try(() => resolveAfter(1, 20));
    const fast = Op.fail("quick" as const);
    const r = await Op.race([slow, fast]).run();
    assert(r.isErr(), "should be Err");
    expect(r.error).toBe("quick");
  });

  test("losers are aborted with no library-specific reason", async () => {
    let observedReason: unknown;
    const slow = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          signal.addEventListener("abort", () => {
            observedReason = signal.reason;
            resolve(-1);
          });
        }),
    );
    const fast = Op.of(1);
    await Op.race([slow, fast]).run();
    assert(observedReason instanceof DOMException, "should be a DOMException");
    expect(observedReason.name).toBe("AbortError");
  });

  test("union type across children", async () => {
    const combined = Op.race([Op.of(1), Op.fail("two" as const)]);
    const r = await combined.run();
    expect(r.isOk() || r.isErr()).toBe(true);
  });

  test("waits for loser finalization before returning winner result", async () => {
    const loserCleanupGate = deferredPromise<void>();
    let loserSawAbort = false;
    const loser = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              loserSawAbort = true;
              loserCleanupGate.promise.then(() => resolve(-1));
            },
            { once: true },
          );
        }),
    );

    const run = Op.race([loser, Op.of(99)]).run();
    let settled = false;
    run.then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(loserSawAbort).toBe(true));
    expect(settled).toBe(false);

    loserCleanupGate.resolve();
    const r = await run;
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(99);
  });

  test("winner error keeps precedence over loser abort-time failures", async () => {
    const loser = Op.try(
      (signal) =>
        new Promise<number>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject("cleanup-failed");
            },
            { once: true },
          );
        }),
      (cause) => cause as "cleanup-failed",
    );

    const r = await Op.race([loser, Op.fail("quick" as const)]).run();
    assert(r.isErr(), "should be Err");
    expect(r.error).toBe("quick");
  });
});

describe("combinator abort listener cleanup", () => {
  test("pre-aborted outer signal does not leave abort listeners behind", async () => {
    const outer = new AbortController();
    outer.abort(new Error("already aborted"));
    const tracked = trackAbortListeners(outer.signal);
    try {
      await Op.all([Op.of(1), Op.of(2)])
        .withSignal(outer.signal)
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
        .withSignal(outer.signal)
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
        .withSignal(outer.signal)
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
                secondGate.promise.then(resolve);
              }),
          ),
        ],
        1,
      )
        .withSignal(outer.signal)
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
        Op.fail("fast-fail" as const),
        Op.try(
          (signal) =>
            new Promise<never>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            }),
        ),
      ])
        .withSignal(outer.signal)
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

describe("instance combinators", () => {
  describe("op.map", () => {
    test("map transforms success values and preserves arity", async () => {
      const op = Op(function* (n: number) {
        return n + 1;
      }).map((value) => `v:${value}`);

      const result = await op.run(2);
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe("v:3");
    });

    test("map does not transform failures", async () => {
      const result = await Op.fail("boom" as const)
        .map(() => 69)
        .run();
      assert(result.isErr(), "should be Err");
      expect(result.error).toBe("boom");
    });

    test("map withRetry only retries the source op, not transform throws", async () => {
      let sourceAttempts = 0;
      let transformAttempts = 0;
      const result = await Op.try(() => {
        sourceAttempts += 1;
        return 1;
      })
        .map(() => {
          transformAttempts += 1;
          throw new Error("parse failed");
        })
        .withRetry({
          maxAttempts: 3,
          shouldRetry: () => true,
          getDelay: () => 0,
        })
        .run();

      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(UnhandledException);
      expect(sourceAttempts).toBe(1);
      expect(transformAttempts).toBe(1);
    });
  });

  describe("op.mapErr", () => {
    test("mapErr transforms failures and preserves arity", async () => {
      const op = Op(function* (n: number) {
        if (n < 0) {
          return yield* Op.fail("negative" as const);
        }
        return n;
      }).mapErr((error) => ({ code: error }));

      const errResult = await op.run(-1);
      assert(errResult.isErr(), "should be Err");
      expect(errResult.error).toEqual({ code: "negative" });

      const okResult = await op.run(2);
      assert(okResult.isOk(), "should be Ok");
      expect(okResult.value).toBe(2);
    });

    test("mapErr does not transform unhandled exceptions", async () => {
      const op = Op(function* () {
        throw new Error("boom");
      }).mapErr(() => "mapped" as const);

      const result = await op.run();
      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(UnhandledException);
    });

    test("mapErr withRetry retries against original error channel", async () => {
      let attempts = 0;
      const mapped = Op(function* () {
        attempts += 1;
        if (attempts < 2) {
          return yield* Op.fail("retryable" as const);
        }
        return 69;
      })
        .mapErr((error) => ({ code: error }))
        .withRetry({
          maxAttempts: 2,
          shouldRetry: (cause) => cause === "retryable",
          getDelay: () => 0,
        });

      const result = await mapped.run();
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(69);
      expect(attempts).toBe(2);
    });

    test("mapErr withTimeout preserves TimeoutError without mapping", async () => {
      const result = await Op.try(
        () => new Promise<number>((resolve) => setTimeout(() => resolve(1), 20)),
        () => "source-failed" as const,
      )
        .mapErr((error) => ({ kind: "app", error }))
        .withTimeout(1)
        .run();

      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(TimeoutError);
    });
  });

  describe("op.flatMap", () => {
    test("flatMap chains operations and merges error channels", async () => {
      const op = Op.of(5).flatMap((value) =>
        value > 3 ? Op.of(`ok:${value}` as const) : Op.fail("too-small" as const),
      );
      const okResult = await op.run();
      assert(okResult.isOk(), "should be Ok");
      expect(okResult.value).toBe("ok:5");

      const errResult = await Op.of(1)
        .flatMap((value) => (value > 3 ? Op.of(value) : Op.fail("too-small" as const)))
        .run();
      assert(errResult.isErr(), "should be Err");
      expect(errResult.error).toBe("too-small");
    });

    test("flatMap on parameterized ops preserves arity and policy chaining", async () => {
      let attempts = 0;
      const op = Op(function* (n: number) {
        attempts += 1;
        if (attempts === 1) {
          return yield* Op.fail("retry" as const);
        }
        return n;
      })
        .flatMap((value) => Op.of(value * 2))
        .withRetry({
          maxAttempts: 2,
          shouldRetry: (cause) => cause === "retry",
          getDelay: () => 0,
        });

      const result = await op.run(4);
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(8);
      expect(attempts).toBe(2);
    });

    test("flatMap withRetry retries the whole composition including bind", async () => {
      let sourceAttempts = 0;
      let bindAttempts = 0;
      const result = await Op.try(() => {
        sourceAttempts += 1;
        return "payload";
      })
        .flatMap(() =>
          Op.try(() => {
            bindAttempts += 1;
            if (bindAttempts < 2) throw new Error("bind failed");
            return 69;
          }),
        )
        .withRetry({
          maxAttempts: 2,
          shouldRetry: () => true,
          getDelay: () => 0,
        })
        .run();

      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(69);
      expect(sourceAttempts).toBe(2);
      expect(bindAttempts).toBe(2);
    });
  });

  describe("op.tap", () => {
    test("tap observes successful values and preserves the original value", async () => {
      const seen: number[] = [];
      const op = Op(function* (n: number) {
        return n + 1;
      }).tap((value) => {
        seen.push(value);
        return "ignored";
      });

      const result = await op.run(2);
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(3);
      expect(seen).toEqual([3]);
    });

    test("tap sequences an Op-returning observer and discards observer output", async () => {
      const seen: string[] = [];
      const op = Op.of(4).tap((value) =>
        Op.of(`observed:${value}`).map((payload) => {
          seen.push(payload);
          return 69;
        }),
      );

      const result = await op.run();
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(4);
      expect(seen).toEqual(["observed:4"]);
    });

    test("tap propagates observer Op failures", async () => {
      const result = await Op.of(4)
        .tap(() => Op.fail("tap-failed" as const))
        .run();
      assert(result.isErr(), "should be Err");
      expect(result.error).toBe("tap-failed");
    });

    test("tap ignores fake Op-shaped functions", async () => {
      const fake = Object.assign(
        () => {
          throw new Error("fake op should not run");
        },
        { _tag: "Op" as const },
      );

      const result = await Op.of(4)
        .tap(() => fake)
        .run();

      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(4);
    });

    test("tap treats parameterized Op returns as plain ignored values", async () => {
      const observer = vi.fn();
      const parameterized = Op(function* (id: string) {
        observer(id);
        return id;
      });

      const result = await Op.of(4)
        .tap(() => parameterized)
        .run();

      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(4);
      expect(observer).not.toHaveBeenCalled();
    });

    test("tap drives Op(function*) observers that succeed", async () => {
      const seen: string[] = [];
      const result = await Op.of(4)
        .tap((value) =>
          Op(function* () {
            seen.push(`observed:${value}`);
            return 69;
          }),
        )
        .run();

      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(4);
      expect(seen).toEqual(["observed:4"]);
    });

    test("tap propagates failures from Op(function*) observers", async () => {
      const result = await Op.of(4)
        .tap(() =>
          Op(function* () {
            return yield* Op.fail("tap-gen-failed" as const);
          }),
        )
        .run();

      assert(result.isErr(), "should be Err");
      expect(result.error).toBe("tap-gen-failed");
    });

    test("tap turns thrown observer errors into UnhandledException", async () => {
      const cause = new Error("observer-boom");
      const result = await Op.of(4)
        .tap(() => {
          throw cause;
        })
        .run();

      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(UnhandledException);
      expect(result.error.cause).toBe(cause);
    });

    test("tap does not run observer when source op fails", async () => {
      const observer = vi.fn();
      const result = await Op.fail("boom" as const)
        .tap(observer)
        .run();
      assert(result.isErr(), "should be Err");
      expect(result.error).toBe("boom");
      expect(observer).not.toHaveBeenCalled();
    });
  });

  describe("op.tapErr", () => {
    test("tapErr observes failures and preserves the original error", async () => {
      const seen: string[] = [];
      const op = Op(function* (kind: "bad" | "ok") {
        if (kind === "bad") {
          return yield* Op.fail("bad-input" as const);
        }
        return 69;
      }).tapErr((error) => {
        seen.push(error);
        return "ignored";
      });

      const errResult = await op.run("bad");
      assert(errResult.isErr(), "should be Err");
      expect(errResult.error).toBe("bad-input");
      expect(seen).toEqual(["bad-input"]);

      const okResult = await op.run("ok");
      assert(okResult.isOk(), "should be Ok");
      expect(okResult.value).toBe(69);
      expect(seen).toEqual(["bad-input"]);
    });

    test("tapErr sequences an Op-returning observer and discards observer output", async () => {
      const seen: string[] = [];
      const result = await Op.fail("bad-input" as const)
        .tapErr((error) =>
          Op.of(error.toUpperCase()).map((payload) => {
            seen.push(payload);
            return 69;
          }),
        )
        .run();

      assert(result.isErr(), "should be Err");
      expect(result.error).toBe("bad-input");
      expect(seen).toEqual(["BAD-INPUT"]);
    });

    test("tapErr propagates observer Op failures", async () => {
      const result = await Op.fail("bad-input" as const)
        .tapErr(() => Op.fail("observer-failed" as const))
        .run();
      assert(result.isErr(), "should be Err");
      expect(result.error).toBe("observer-failed");
    });

    test("tapErr drives Op(function*) observers that succeed", async () => {
      const seen: string[] = [];
      const result = await Op.fail("bad-input" as const)
        .tapErr((error) =>
          Op(function* () {
            seen.push(error.toUpperCase());
            return 69;
          }),
        )
        .run();

      assert(result.isErr(), "should be Err");
      expect(result.error).toBe("bad-input");
      expect(seen).toEqual(["BAD-INPUT"]);
    });

    test("tapErr propagates failures from Op(function*) observers", async () => {
      const result = await Op.fail("bad-input" as const)
        .tapErr(() =>
          Op(function* () {
            return yield* Op.fail("tap-err-gen-failed" as const);
          }),
        )
        .run();

      assert(result.isErr(), "should be Err");
      expect(result.error).toBe("tap-err-gen-failed");
    });

    test("tapErr turns thrown observer errors into UnhandledException", async () => {
      const cause = new Error("observer-boom");
      const result = await Op.fail("bad-input" as const)
        .tapErr(() => {
          throw cause;
        })
        .run();

      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(UnhandledException);
      if (result.error instanceof UnhandledException) {
        expect(result.error.cause).toBe(cause);
      }
    });

    test("tapErr does not run observer on success", async () => {
      const observer = vi.fn();
      const result = await Op.of(69).tapErr(observer).run();
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(69);
      expect(observer).not.toHaveBeenCalled();
    });

    test("tapErr bypasses UnhandledException values", async () => {
      const observer = vi.fn();
      const result = await Op(function* () {
        throw new Error("boom");
      })
        .tapErr(observer)
        .run();
      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(UnhandledException);
      expect(observer).not.toHaveBeenCalled();
    });
  });

  describe("op.recover", () => {
    test("recover narrows handled error type via type guard predicate", async () => {
      class AErr extends TaggedError("AErr")() {}
      class BErr extends TaggedError("BErr")() {}
      class RecoveryErr extends TaggedError("RecoveryErr")() {}

      const op = Op(function* (kind: "a" | "b") {
        if (kind === "a") {
          return yield* new AErr();
        }
        return yield* new BErr();
      }).recover(AErr.is, () => Op.fail(new RecoveryErr()));

      const recovered = await op.run("a");
      assert(recovered.isErr(), "should be Err");
      expect(recovered.error).toBeInstanceOf(RecoveryErr);

      const passthrough = await op.run("b");
      assert(passthrough.isErr(), "should be Err");
      expect(passthrough.error).toBeInstanceOf(BErr);
    });

    test("recover can return a plain fallback value", async () => {
      class MissingConfigError extends TaggedError("MissingConfigError")() {}

      const recovered = Op(function* () {
        return yield* new MissingConfigError();
      }).recover(MissingConfigError.is, () => "fallback" as const);

      const result = await recovered.run();
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe("fallback");
    });

    test("recover can sequence a recovery op", async () => {
      class MissingConfigError extends TaggedError("MissingConfigError")() {}

      const recovered = Op(function* () {
        return yield* new MissingConfigError();
      }).recover(MissingConfigError.is, () => Op.of(69));

      const result = await recovered.run();
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(69);
    });

    test("recover drives Op(function*) handlers that succeed", async () => {
      class MissingConfigError extends TaggedError("MissingConfigError")() {}

      const recovered = Op(function* () {
        return yield* new MissingConfigError();
      }).recover(MissingConfigError.is, () =>
        Op(function* () {
          return 69;
        }),
      );

      const result = await recovered.run();
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe(69);
    });

    test("recover propagates failures from Op(function*) handlers", async () => {
      class MissingConfigError extends TaggedError("MissingConfigError")() {}
      class RecoveryErr extends TaggedError("RecoveryErr")() {}

      const recovered = Op(function* () {
        return yield* new MissingConfigError();
      }).recover(MissingConfigError.is, () =>
        Op(function* () {
          return yield* new RecoveryErr();
        }),
      );

      const result = await recovered.run();
      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(RecoveryErr);
    });

    test("recover bypasses UnhandledException even when predicate matches", async () => {
      const recovered = Op(function* () {
        throw new Error("boom");
      }).recover(
        () => true,
        () => "fallback" as const,
      );

      const result = await recovered.run();
      assert(result.isErr(), "should be Err");
      expect(result.error).toBeInstanceOf(UnhandledException);
    });

    test("recover can handle typed errors with explicit constructor", async () => {
      class TestError extends TaggedError("TestError")() {}
      const recovered = Op(function* () {
        if (TRUE) {
          return yield* new TestError();
        }
        return 69;
      }).recover(TestError, () => "fallback");

      const result = await recovered.run();
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe("fallback");
    });

    test("recover with constructor predicate preserves arity", async () => {
      class TestError extends TaggedError("TestError")() {}
      const recovered = Op(function* (n: number) {
        if (n < 0) {
          return yield* new TestError();
        }
        return n;
      }).recover(TestError, () => "fallback");

      const result = await recovered.run(-1);
      assert(result.isOk(), "should be Ok");
      expect(result.value).toBe("fallback");
    });

    test("recover with constructor predicate allows only errors from the Op to be recovered", async () => {
      class E1 extends TaggedError("E1")() {}
      class E2 extends TaggedError("E2")() {}
      class E3 extends TaggedError("E3")() {}
      const op = Op(function* () {
        if (TRUE) {
          return yield* new E1();
        }
        return yield* new E2();
      });

      const recovered1 = op.recover(E1, () => "fallback");

      const result1 = await recovered1.run();
      assert(result1.isOk(), "should be Ok");
      expect(result1.value).toBe("fallback");

      const recovered2 = op.recover(E2, () => "fallback1");

      const result2 = await recovered2.run();
      assert(result2.isErr(), "should be Err");
      expect(result2.error).toBeInstanceOf(E1);

      void E3;
    });
  });
});
