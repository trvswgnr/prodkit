import { UnhandledException } from "../../errors.js";
import { Result } from "../../result.js";
import { SuspendInstruction, SuspendResume } from "../instructions.js";
import type { RunContext } from "../runtime.js";
import { createPlan, type Plan } from "./base.js";
import { driveAllPlans, driveAllSettledPlans, driveAnyPlans, driveRacePlans } from "./fan-out.js";

export function allPlan<T, E, M>(
  children: readonly Plan<T, E, M>[],
  concurrency?: number,
): Plan<T[], E, M> {
  const snapshot = children.slice();

  return createPlan(
    function* () {
      const result: Result<T[], E | UnhandledException> = yield* new SuspendInstruction(
        (outerContext: RunContext<readonly unknown[]>) =>
          driveAllPlans(snapshot, outerContext, concurrency),
        SuspendResume.drainAfterAbort,
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (self, rewriter) => rewriter.all?.(snapshot, concurrency) ?? rewriter.apply(self),
    },
  );
}

export function racePlan<T, E, M>(children: readonly Plan<T, E, M>[]): Plan<T, E, M> {
  const snapshot = children.slice();

  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (outerContext: RunContext<readonly unknown[]>) => driveRacePlans(snapshot, outerContext),
        SuspendResume.drainAfterAbort,
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (self, rewriter) => rewriter.race?.(snapshot) ?? rewriter.apply(self),
    },
  );
}

export function anyPlan<T, E, M>(children: readonly Plan<T, E, M>[]): Plan<T, E, M> {
  const snapshot = children.slice();

  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (outerContext: RunContext<readonly unknown[]>) => driveAnyPlans(snapshot, outerContext),
        SuspendResume.drainAfterAbort,
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (self, rewriter) => rewriter.any?.(snapshot) ?? rewriter.apply(self),
    },
  );
}

export function allSettledPlan<T, E, M>(
  children: readonly Plan<T, E, M>[],
  concurrency?: number,
): Plan<Result<T, E | UnhandledException>[], UnhandledException, M> {
  const snapshot = children.slice();

  return createPlan(
    function* () {
      const result: Result<Result<T, E | UnhandledException>[], UnhandledException> =
        yield* new SuspendInstruction(
          (outerContext: RunContext<readonly unknown[]>) =>
            driveAllSettledPlans(snapshot, outerContext, concurrency),
          SuspendResume.passThrough,
        );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (self, rewriter) =>
        rewriter.allSettled?.(snapshot, concurrency) ?? rewriter.apply(self),
    },
  );
}
