import * as fc from "fast-check";
import { assert, describe, expect, test } from "vitest";
import { ErrorGroup, Op } from "../../src/index.js";
import { rejectAfter, resolveAfter } from "../support/utils.js";

function delayedFail<T>(tag: T, ms: number) {
  return Op.try(
    () => rejectAfter(tag, ms),
    (): T => tag,
  );
}

function delayedOk<T>(value: T, ms: number) {
  return Op.try(() => resolveAfter(value, ms));
}

describe("Op.any invariants", () => {
  test("all-fail ErrorGroup.errors stay in input index order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(fc.tuple(fc.string(), fc.integer({ min: 0, max: 25 })), {
            minLength: 1,
            maxLength: 8,
          })
          .filter((entries) => new Set(entries.map(([tag]) => tag)).size === entries.length),
        async (entries) => {
          const ops = entries.map(([tag, delay]) => delayedFail(tag, delay));
          const result = await Op.any(ops).run();

          assert(result.isErr(), "all branches failed");
          assert(ErrorGroup.is(result.error), "expected ErrorGroup");
          expect(result.error.errors).toEqual(entries.map(([tag]) => tag));
        },
      ),
    );
  });

  test("any-success returns a member of the success set", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({ kind: fc.constant("ok"), value: fc.integer(), delay: fc.nat(25) }),
            fc.record({
              kind: fc.constant("fail"),
              error: fc.string(),
              delay: fc.nat(25),
            }),
          ),
          { minLength: 1, maxLength: 8 },
        ),
        async (branches) => {
          const successValues: number[] = [];
          const ops = branches.map((branch) => {
            if (branch.kind === "ok") {
              successValues.push(branch.value);
              return delayedOk(branch.value, branch.delay);
            }
            return delayedFail(branch.error, branch.delay);
          });

          const result = await Op.any(ops).run();

          if (successValues.length === 0) {
            assert(result.isErr(), "expected all-fail when no success branch exists");
            return;
          }

          assert(result.isOk(), "expected success when at least one branch succeeds");
          expect(successValues).toContain(result.value);
        },
      ),
    );
  });

  test("any-success aborts unresolved siblings", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 40 }),
        fc.integer(),
        fc.array(fc.nat(25), { minLength: 0, maxLength: 4 }),
        async (slowDelay, successValue, siblingDelays) => {
          const abortObserved: boolean[] = [];

          const slowBranch = Op.try(
            (signal) =>
              new Promise<number>((resolve) => {
                const timer = setTimeout(() => resolve(-1), slowDelay);
                signal.addEventListener("abort", () => {
                  abortObserved.push(true);
                  clearTimeout(timer);
                  resolve(-1);
                });
              }),
          );

          const siblings = siblingDelays.map((delay, index) => {
            abortObserved.push(false);
            const slot = index;
            return Op.try(
              (signal) =>
                new Promise<number>((resolve) => {
                  const timer = setTimeout(() => resolve(-1), delay);
                  signal.addEventListener("abort", () => {
                    abortObserved[slot] = true;
                    clearTimeout(timer);
                    resolve(-1);
                  });
                }),
            );
          });

          const result = await Op.any([slowBranch, ...siblings, Op.of(successValue)]).run();

          assert(result.isOk(), "expected instant success branch to win");
          expect(result.value).toBe(successValue);
          expect(abortObserved.every(Boolean)).toBe(true);
        },
      ),
    );
  });

  test("empty input returns ErrorGroup([])", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const result = await Op.any([]).run();

        assert(result.isErr(), "expected Err for empty input");
        assert(ErrorGroup.is(result.error), "expected ErrorGroup");
        expect(result.error.errors).toEqual([]);
      }),
    );
  });
});
