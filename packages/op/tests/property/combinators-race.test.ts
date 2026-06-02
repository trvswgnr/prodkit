import * as fc from "fast-check";
import { assert, describe, expect, test, vi } from "vitest";
import { Op } from "../../src/index.js";
import { rejectAfter, resolveAfter, trackAbortListeners } from "../support/utils.js";
import { Policy } from "../../src/policy/index.js";
import {
  assertRaceResultsEqual,
  branchAt,
  FC_SCHEDULER_ASSERT_OPTIONS,
  firstSettlerRaceBranchIndex,
  pendingUntilAbortOp,
  raceOpFromScheduledBranch,
  raceResultFromBranch,
} from "../support/scheduler.js";

const raceBranchArb = fc.oneof(
  fc.record({ kind: fc.constant("ok" as const), value: fc.integer() }),
  fc.record({ kind: fc.constant("err" as const), error: fc.string() }),
);

const raceBranchesArb = fc.array(raceBranchArb, { minLength: 1, maxLength: 6 });

describe("Op.race invariants", () => {
  test("result matches first-settler under scheduler-controlled completion order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), raceBranchesArb, async (s, branches) => {
        const ops = branches.map((branch, index) =>
          raceOpFromScheduledBranch(s, branch, `branch-${index}`),
        );

        const resultPromise = Op.race(ops).run();
        const result = await s.waitFor(resultPromise);

        const winnerIndex = firstSettlerRaceBranchIndex(s.report(), "branch-", branches.length);
        assertRaceResultsEqual(result, raceResultFromBranch(branchAt(branches, winnerIndex)));
      }),
      FC_SCHEDULER_ASSERT_OPTIONS,
    );
  });

  test("setTimeout delays still pick earliest finisher (fake timers)", async () => {
    await fc.assert(
      fc
        .asyncProperty(
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
            { minLength: 1, maxLength: 4 },
          ),
          async (branches) => {
            const maxDelay = branches.reduce((max, branch) => Math.max(max, branch.delay), 0);
            const ops = branches.map((branch) => {
              if (branch.kind === "ok") {
                return Op.try(() => resolveAfter(branch.value, branch.delay));
              }

              return Op.try(
                () => rejectAfter(branch.error, branch.delay),
                (cause: unknown): string => {
                  if (typeof cause !== "string") {
                    throw new Error(`expected string cause, got ${typeof cause}`);
                  }
                  return cause;
                },
              );
            });

            let winnerIndex = 0;
            let minDelay = branchAt(branches, 0).delay;
            for (let i = 1; i < branches.length; i += 1) {
              const delay = branchAt(branches, i).delay;
              if (delay < minDelay) {
                minDelay = delay;
                winnerIndex = i;
              } else if (delay === minDelay && i < winnerIndex) {
                winnerIndex = i;
              }
            }

            const resultPromise = Op.race(ops).run();
            await vi.advanceTimersByTimeAsync(maxDelay);
            const result = await resultPromise;
            const expected = branchAt(branches, winnerIndex);

            if (expected.kind === "ok") {
              assert(result.isOk(), "expected Ok from earliest branch");
              expect(result.value).toBe(expected.value);
              return;
            }

            assert(result.isErr(), "expected Err from earliest branch");
            expect(result.error).toBe(expected.error);
          },
        )
        .beforeEach(() => {
          vi.useFakeTimers();
        })
        .afterEach(() => {
          vi.useRealTimers();
        }),
      FC_SCHEDULER_ASSERT_OPTIONS,
    );
  });

  test("non-winning branches observe abort when an instant branch wins", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.integer(),
        fc.array(fc.integer(), { minLength: 1, maxLength: 4 }),
        async (s, winnerValue, siblingSlots) => {
          const abortObserved = siblingSlots.map(() => false);

          const siblings = siblingSlots.map((_, index) =>
            pendingUntilAbortOp(s, `sibling-${index}`, () => {
              abortObserved[index] = true;
            }),
          );

          const resultPromise = Op.race([...siblings, Op.of(winnerValue)]).run();
          const result = await s.waitFor(resultPromise);

          assert(result.isOk(), "expected instant winner");
          expect(result.value).toBe(winnerValue);
          expect(abortObserved.every(Boolean)).toBe(true);
        },
      ),
      FC_SCHEDULER_ASSERT_OPTIONS,
    );
  });

  test("cleans up abort listeners after completion", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.array(fc.integer(), { minLength: 1, maxLength: 5 }),
        async (s, branchValues) => {
          const outer = new AbortController();
          const tracked = trackAbortListeners(outer.signal);

          try {
            const ops = branchValues.map((value, index) =>
              raceOpFromScheduledBranch(s, { kind: "ok", value }, `branch-${index}`),
            );

            const resultPromise = Op.race(ops).with(Policy.cancel(outer.signal)).run();
            const result = await s.waitFor(resultPromise);

            assert(result.isOk(), "expected race success");
            expect(tracked.activeAbortListeners).toBe(0);

            outer.abort(new Error("too late"));
            expect(tracked.activeAbortListeners).toBe(0);
          } finally {
            tracked.restore();
          }
        },
      ),
      FC_SCHEDULER_ASSERT_OPTIONS,
    );
  });
});
