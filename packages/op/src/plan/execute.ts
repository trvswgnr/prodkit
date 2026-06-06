import { unsafeCoerce } from "@prodkit/shared/runtime";
import { UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { driveIterator, type RunContext } from "../execution/runtime.js";
import { AbortSettlement } from "../execution/settlement.js";
import type { Plan } from "./model.js";

type ErasedPlan = Plan<unknown, unknown, unknown>;
type PlanExecutionJob = {
  readonly plan: ErasedPlan;
  readonly context: RunContext<readonly unknown[]>;
  readonly settlement: AbortSettlement;
  readonly resolve: (result: Result<unknown, unknown | UnhandledException>) => void;
  readonly reject: (cause: unknown) => void;
};

let activePlanExecutionCount = 0;
const planExecutionQueue: PlanExecutionJob[] = [];
let planExecutionPumpScheduled = false;
const MAX_SYNC_PLAN_EXECUTION_DEPTH = 128;

export function executePlan<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  settlement: AbortSettlement = AbortSettlement.passThrough,
): Promise<Result<T, E | UnhandledException>> {
  if (activePlanExecutionCount < MAX_SYNC_PLAN_EXECUTION_DEPTH) {
    return executePlanDirect(plan, context, settlement);
  }

  return enqueuePlanExecution(plan, context, settlement);
}

async function executePlanDirect<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  settlement: AbortSettlement,
): Promise<Result<T, E | UnhandledException>> {
  activePlanExecutionCount += 1;
  try {
    // SAFETY: driveIterator may return UnhandledException; executePlan widens E for settlement faults.
    return unsafeCoerce(await driveIterator(plan.iterate(), context, settlement));
  } finally {
    activePlanExecutionCount -= 1;
  }
}

function enqueuePlanExecution<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  settlement: AbortSettlement,
): Promise<Result<T, E | UnhandledException>> {
  return new Promise((resolve, reject) => {
    // SAFETY: queued jobs erase plan generics and restore them through the typed promise returned by executePlan.
    const erasedPlan: ErasedPlan = unsafeCoerce(plan);
    // SAFETY: the queued result is the same Result shape, with generics erased at the queue boundary only.
    const erasedResolve: PlanExecutionJob["resolve"] = unsafeCoerce(resolve);
    planExecutionQueue.push({
      plan: erasedPlan,
      context,
      settlement,
      resolve: erasedResolve,
      reject,
    });
    schedulePlanExecutionPump();
  });
}

function schedulePlanExecutionPump() {
  if (planExecutionPumpScheduled) return;
  planExecutionPumpScheduled = true;
  queueMicrotask(pumpPlanExecutionQueue);
}

function pumpPlanExecutionQueue() {
  planExecutionPumpScheduled = false;

  while (true) {
    const job = planExecutionQueue.shift();
    if (job === undefined) return;

    void executePlanDirect(job.plan, job.context, job.settlement).then(job.resolve, job.reject);
  }
}
