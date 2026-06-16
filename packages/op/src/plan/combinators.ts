import { UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { SuspendInstruction } from "../execution/instructions.js";
import { Settlement } from "../execution/settlement.js";
import type { RunContext } from "../execution/runtime.js";
import { createPlan, createUnaryPlan, type Plan, type PlanRewriter } from "./model.js";
import {
  driveAllPlans,
  driveAllSettledPlans,
  driveAnyPlans,
  driveRacePlans,
} from "../execution/fan-out.js";

function rewritePlanChildren<T, E, M>(
  snapshot: readonly Plan<T, E, M>[],
  rewriter: PlanRewriter,
): Plan<T, E, M>[] {
  return snapshot.map((child) => child.rewrite(rewriter));
}

function* interruptingFanOutPlan<T, E>(
  drive: (
    outerContext: RunContext<readonly unknown[]>,
  ) => Promise<Result<T, E | UnhandledException>>,
) {
  const result: Result<T, E | UnhandledException> =
    yield* Settlement.interruptingAndDraining.suspend(drive);

  if (result.isErr()) return yield* result;
  return result.value;
}

export function allPlan<T, E, M>(
  children: readonly Plan<T, E, M>[],
  concurrency?: number,
): Plan<T[], E, M> {
  const snapshot = children.slice();

  return createPlan(
    function* () {
      return yield* interruptingFanOutPlan((outerContext) =>
        driveAllPlans(snapshot, outerContext, concurrency),
      );
    },
    {
      rewrite: (_self, rewriter) => allPlan(rewritePlanChildren(snapshot, rewriter), concurrency),
    },
  );
}

export function racePlan<T, E, M>(children: readonly Plan<T, E, M>[]): Plan<T, E, M> {
  const snapshot = children.slice();

  return createPlan(
    function* () {
      return yield* interruptingFanOutPlan((outerContext) =>
        driveRacePlans(snapshot, outerContext),
      );
    },
    {
      rewrite: (_self, rewriter) => racePlan(rewritePlanChildren(snapshot, rewriter)),
    },
  );
}

export function anyPlan<T, E, M>(children: readonly Plan<T, E, M>[]): Plan<T, E, M> {
  const snapshot = children.slice();

  return createPlan(
    function* () {
      return yield* interruptingFanOutPlan((outerContext) => driveAnyPlans(snapshot, outerContext));
    },
    {
      rewrite: (_self, rewriter) => anyPlan(rewritePlanChildren(snapshot, rewriter)),
    },
  );
}

export function settlePlan<T, E, M>(
  source: Plan<T, E, M>,
): Plan<Result<T, E | UnhandledException>, never, M> {
  return createUnaryPlan(
    function* () {
      const child: Result<T, E | UnhandledException> =
        yield* Settlement.cooperative.suspendPlan(source);

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
        allSettledPlan(rewritePlanChildren(snapshot, rewriter), concurrency),
    },
  );
}
