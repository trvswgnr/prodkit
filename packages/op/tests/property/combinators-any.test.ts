import * as fc from "fast-check";
import { assert, describe, expect, test } from "vitest";
import { ErrorGroup, Op } from "../../src/index.js";
import {
  anyFailOpFromScheduledBranch,
  anyOkOpFromScheduledBranch,
  branchAt,
  FC_SCHEDULER_ASSERT_OPTIONS,
  firstSuccessAnyBranchIndex,
  pendingUntilAbortOp,
  type SchedulerAnyBranch,
} from "../support/scheduler.js";

const anyBranchArb = fc.oneof(
  fc.record({ kind: fc.constant("ok" as const), value: fc.integer() }),
  fc.record({ kind: fc.constant("fail" as const), error: fc.string() }),
);

const anyBranchesArb = fc.array(anyBranchArb, { minLength: 1, maxLength: 8 });

function anyOpFromScheduledBranch(s: fc.Scheduler, branch: SchedulerAnyBranch, label: string) {
  if (branch.kind === "ok") {
    return anyOkOpFromScheduledBranch(s, branch.value, label);
  }

  return anyFailOpFromScheduledBranch(s, branch.error, label);
}

describe("Op.any invariants", () => {
  test("all-fail ErrorGroup.errors stay in input index order under scheduler reordering", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 8 }),
        async (s, tags) => {
          const ops = tags.map((tag, index) =>
            anyFailOpFromScheduledBranch(s, tag, `branch-${index}`),
          );

          const result = await s.waitFor(Op.any(ops).run());

          assert(result.isErr(), "all branches failed");
          assert(ErrorGroup.is(result.error), "expected ErrorGroup");
          expect(result.error.errors).toEqual(tags);
        },
      ),
      FC_SCHEDULER_ASSERT_OPTIONS,
    );
  });

  test("first scheduled success wins under scheduler-controlled completion order", async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), anyBranchesArb, async (s, branches) => {
        const successValues = branches.flatMap((branch) =>
          branch.kind === "ok" ? [branch.value] : [],
        );

        const ops = branches.map((branch, index) =>
          anyOpFromScheduledBranch(s, branch, `branch-${index}`),
        );

        const result = await s.waitFor(Op.any(ops).run());

        if (successValues.length === 0) {
          assert(result.isErr(), "expected all-fail when no success branch exists");
          return;
        }

        const winnerIndex = firstSuccessAnyBranchIndex(s.report(), "branch-", branches);
        assert(winnerIndex !== undefined, "expected a winning ok branch in scheduler report");
        const winner = branchAt(branches, winnerIndex);
        assert(winner.kind === "ok", "winner branch should be ok");
        assert(result.isOk(), "expected success when at least one branch succeeds");
        expect(result.value).toBe(winner.value);
      }),
      FC_SCHEDULER_ASSERT_OPTIONS,
    );
  });

  test("instant success aborts scheduler-pending siblings", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.integer(),
        fc.array(fc.integer(), { minLength: 0, maxLength: 4 }),
        async (s, successValue, siblingSlots) => {
          const abortObserved = siblingSlots.map(() => false);

          const siblings = siblingSlots.map((_, index) =>
            pendingUntilAbortOp(s, `sibling-${index}`, () => {
              abortObserved[index] = true;
            }),
          );

          const result = await s.waitFor(Op.any([...siblings, Op.of(successValue)]).run());

          assert(result.isOk(), "expected instant success branch to win");
          expect(result.value).toBe(successValue);
          expect(abortObserved.every(Boolean)).toBe(true);
        },
      ),
      FC_SCHEDULER_ASSERT_OPTIONS,
    );
  });

  test("empty input returns ErrorGroup([])", async () => {
    const result = await Op.any([]).run();

    assert(result.isErr(), "expected Err for empty input");
    assert(ErrorGroup.is(result.error), "expected ErrorGroup");
    expect(result.error.errors).toEqual([]);
  });
});
