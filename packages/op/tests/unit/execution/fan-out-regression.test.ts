import { assert, describe, expect, test, vi } from "vitest";
import { Op } from "../../../src/index.js";
import { deferredPromise, neverSettling } from "../../support/utils.js";

/**
 * Focused regression harness for fan-out scheduling invariants.
 *
 * Fan-out scheduling lives in `packages/op/src/execution/fan-out.ts` (`driveFanOutPlans`).
 * Contributor outcome notes: `docs/contributor/op-invariants.md` (Fan-out scheduling).
 */
describe("fan-out regression harness", () => {
  describe("bounded concurrency", () => {
    test("caps concurrent children and aborts in-flight siblings on first Err", async () => {
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
      const queued = Op.try(() => {
        queuedStarted = true;
        return 3;
      });

      const result = await Op.all([slow, Op.fail("boom"), queued], 2).run();

      assert(result.isErr(), "bounded fail-fast all should return first Err");
      expect(result.error).toBe("boom");
      expect(slowObservedAbort).toBe(true);
      expect(queuedStarted).toBe(false);
    });
  });

  describe("first-settler", () => {
    test("Op.race waits for loser defer cleanup before run() settles", async () => {
      const loserCleanupGate = deferredPromise<void>();
      let loserCleanupStarted = false;

      const loser = Op(function* () {
        yield* Op.defer(async () => {
          loserCleanupStarted = true;
          await loserCleanupGate.promise;
        });
        yield* Op.try(neverSettling);
      });

      const run = Op.race([loser, Op.of(9)]).run();
      let settled = false;
      void run.then(() => (settled = true));

      await vi.waitFor(() => expect(loserCleanupStarted).toBe(true));
      expect(settled).toBe(false);

      loserCleanupGate.resolve();
      const result = await run;

      assert(result.isOk(), "first settler race should return winner Ok");
      expect(result.value).toBe(9);
    });

    test("Op.any aborts losers after first Ok and waits for loser teardown", async () => {
      let loserAborted = false;
      const slow = Op.try(
        (signal) =>
          new Promise<number>((resolve) => {
            signal.addEventListener("abort", () => {
              loserAborted = true;
              resolve(-1);
            });
          }),
      );

      const result = await Op.any([slow, Op.of(42)]).run();

      assert(result.isOk(), "first settler any should return first Ok");
      expect(result.value).toBe(42);
      expect(loserAborted).toBe(true);
    });
  });
});
