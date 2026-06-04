import { UnhandledException } from "../../errors.js";
import { Result } from "../../result.js";
import { SuspendInstruction, withAbortDrain } from "../instructions.js";
import type { RunContext } from "../runtime.js";
import { createPlan, createUnaryPlan, type Plan } from "./base.js";
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
          withAbortDrain(driveAllPlans(snapshot, outerContext, concurrency)),
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (_self, rewriter) =>
        allPlan(
          snapshot.map((child) => child.rewrite(rewriter)),
          concurrency,
        ),
    },
  );
}

export function racePlan<T, E, M>(children: readonly Plan<T, E, M>[]): Plan<T, E, M> {
  const snapshot = children.slice();

  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (outerContext: RunContext<readonly unknown[]>) =>
          withAbortDrain(driveRacePlans(snapshot, outerContext)),
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (_self, rewriter) => racePlan(snapshot.map((child) => child.rewrite(rewriter))),
    },
  );
}

export function anyPlan<T, E, M>(children: readonly Plan<T, E, M>[]): Plan<T, E, M> {
  const snapshot = children.slice();

  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (outerContext: RunContext<readonly unknown[]>) =>
          withAbortDrain(driveAnyPlans(snapshot, outerContext)),
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (_self, rewriter) => anyPlan(snapshot.map((child) => child.rewrite(rewriter))),
    },
  );
}

export function settlePlan<T, E, M>(
  source: Plan<T, E, M>,
): Plan<Result<T, E | UnhandledException>, never, M> {
  return createUnaryPlan(
    function* () {
      const child: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      return child;
    },
    source,
    settlePlan,
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
        yield* new SuspendInstruction((outerContext: RunContext<readonly unknown[]>) =>
          driveAllSettledPlans(snapshot, outerContext, concurrency),
        );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (_self, rewriter) =>
        allSettledPlan(
          snapshot.map((child) => child.rewrite(rewriter)),
          concurrency,
        ),
    },
  );
}
