import * as fc from "fast-check";
import { assert, describe, expect, test } from "vitest";
import { Op } from "./index.js";
import { rejectAfter, resolveAfter, trackAbortListeners } from "./test-utils.js";

type RaceBranch =
  | { kind: "ok"; value: number; delay: number }
  | { kind: "err"; error: string; delay: number };

function branchOp(branch: RaceBranch) {
  if (branch.kind === "ok") {
    return Op.try(() => resolveAfter(branch.value, branch.delay));
  }

  return Op.try(
    () => rejectAfter(branch.error, branch.delay),
    (cause) => cause as string,
  );
}

async function oracleFirstSettler(branches: readonly RaceBranch[]): Promise<RaceBranch> {
  if (branches.length === 0) {
    throw new Error("race oracle expected at least one branch");
  }

  let winnerIndex: number | undefined;

  await Promise.all(
    branches.map(
      (branch, index) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (winnerIndex === undefined) winnerIndex = index;
            resolve();
          }, branch.delay);
        }),
    ),
  );

  const winner = branches[winnerIndex ?? 0];
  if (!winner) {
    throw new Error("race oracle failed to resolve a winner");
  }

  return winner;
}

describe("Op.race invariants (property-based)", () => {
  test("result matches first-settler outcome under randomized delays", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant("ok" as const),
              value: fc.integer(),
              delay: fc.nat(25),
            }),
            fc.record({
              kind: fc.constant("err" as const),
              error: fc.string(),
              delay: fc.nat(25),
            }),
          ),
          { minLength: 1, maxLength: 6 },
        ),
        async (branches) => {
          const ops = branches.map((branch) => branchOp(branch));
          const [result, expected] = await Promise.all([
            Op.race(ops).run(),
            oracleFirstSettler(branches),
          ]);

          if (expected.kind === "ok") {
            assert(result.isOk(), "expected Ok from first settler");
            expect(result.value).toBe(expected.value);
            return;
          }

          assert(result.isErr(), "expected Err from first settler");
          expect(result.error).toBe(expected.error);
        },
      ),
    );
  });

  test("non-winning branches observe abort", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 15, max: 40 }),
        fc.integer(),
        fc.array(fc.nat(10), { minLength: 1, maxLength: 4 }),
        async (slowDelay, winnerValue, fastDelays) => {
          const abortObserved: boolean[] = fastDelays.map(() => false);

          const slowBranch = Op.try(
            (signal) =>
              new Promise<number>((resolve) => {
                const timer = setTimeout(() => resolve(-1), slowDelay);
                signal.addEventListener("abort", () => {
                  clearTimeout(timer);
                  resolve(-1);
                });
              }),
          );

          const fastBranches = fastDelays.map((delay, index) =>
            Op.try(
              (signal) =>
                new Promise<number>((resolve) => {
                  const timer = setTimeout(() => resolve(-1), delay);
                  signal.addEventListener("abort", () => {
                    abortObserved[index] = true;
                    clearTimeout(timer);
                    resolve(-1);
                  });
                }),
            ),
          );

          const result = await Op.race([slowBranch, ...fastBranches, Op.of(winnerValue)]).run();

          assert(result.isOk(), "expected instant winner");
          expect(result.value).toBe(winnerValue);
          expect(abortObserved.every(Boolean)).toBe(true);
        },
      ),
    );
  });

  test("cleans up abort listeners after completion", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(15), { minLength: 1, maxLength: 5 }), async (delays) => {
        const outer = new AbortController();
        const tracked = trackAbortListeners(outer.signal);

        try {
          const ops = delays.map((delay, index) => Op.try(() => resolveAfter(index, delay)));

          const result = await Op.race(ops).withSignal(outer.signal).run();
          assert(result.isOk(), "expected race success");

          expect(tracked.activeAbortListeners).toBe(0);

          outer.abort(new Error("too late"));
          expect(tracked.activeAbortListeners).toBe(0);
        } finally {
          tracked.restore();
        }
      }),
    );
  });
});
