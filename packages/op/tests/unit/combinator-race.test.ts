import { assert, describe, expect, test, vi } from "vitest";
import { Op } from "../../src/index.js";
import { deferredPromise, neverSettling, resolveAfter, settleOutcome } from "../support/utils.js";
import { identity } from "../../src/shared.js";

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
    const fast = Op.fail("quick");
    const r = await Op.race([slow, fast]).run();
    assert(r.isErr(), "should be Err");
    expect(r.error).toBe("quick");
  });

  test("children begin async work in input index order", async () => {
    const registrationOrder: number[] = [];
    const gate = deferredPromise<void>();

    const branch = (id: number) =>
      Op.try((_signal) => {
        registrationOrder.push(id);
        return gate.promise;
      });

    const run = Op.race([branch(0), branch(1), branch(2)]).run();
    await vi.waitFor(() => expect(registrationOrder).toEqual([0, 1, 2]));

    gate.resolve(undefined);
    await run;
  });

  test("equal-delay branches settle in input index order", async () => {
    vi.useFakeTimers();
    try {
      const run = Op.race([
        Op.try(() => resolveAfter(0, 5)),
        Op.try(() => resolveAfter(1, 5)),
        Op.try(() => resolveAfter(2, 5)),
      ]).run();

      await vi.advanceTimersByTimeAsync(5);
      const r = await run;

      assert(r.isOk(), "should be Ok");
      expect(r.value).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
    const combined = Op.race([Op.of(1), Op.fail("two")]);
    const r = await combined.run();
    expect(r.isOk() || r.isErr()).toBe(true);
  });

  test("waits for loser finalization before returning winner result", async () => {
    const loserCleanupGate = deferredPromise<void>();
    let loserCleanupStarted = false;
    const loser = Op(function* () {
      yield* Op.defer(async () => {
        loserCleanupStarted = true;
        await loserCleanupGate.promise;
      });
      yield* Op.try(neverSettling);
    });

    const run = Op.race([loser, Op.of(99)]).run();
    let settled = false;
    void run.then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(loserCleanupStarted).toBe(true));
    expect(settled).toBe(false);

    loserCleanupGate.resolve();
    const r = await run;
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(99);
  });

  test("winner error keeps precedence over loser abort-time failures", async () => {
    const loser = Op.try(
      (signal) =>
        new Promise<number>((_, reject) =>
          signal.addEventListener("abort", () => reject("cleanup-failed"), { once: true }),
        ),
      identity,
    );

    const r = await Op.race([loser, Op.fail("quick")]).run();
    assert(r.isErr(), "should be Err");
    expect(r.error).toBe("quick");
  });

  test("settles when the winner succeeds and a loser ignores abort", async () => {
    const run = Op.race([Op.of("winner"), Op.try(neverSettling)]).run();
    expect(await settleOutcome(run)).toBe("settled");
    const r = await run;
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe("winner");
  });
});
