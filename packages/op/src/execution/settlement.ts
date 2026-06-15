import { abortReason } from "@prodkit/shared/runtime";
import { UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import type { Plan } from "../plan/model.js";
import { SuspendInstruction } from "./instructions.js";
import type { RunContext } from "./runtime.js";
import {
  AbortSettlement,
  awaitWithAbort,
  withAbortDrain,
  withAbortOwnership,
} from "./abort-settlement.js";

type MapChildContext = (parent: RunContext<readonly unknown[]>) => RunContext<readonly unknown[]>;

function runPlan<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  settlement: AbortSettlement,
): Promise<Result<T, E | UnhandledException>> {
  return plan.execute(context, settlement);
}

function interruptOnAbort(signal: AbortSignal): AbortSettlement {
  return AbortSettlement.interruptOnAbort(() => abortReason(signal));
}

/**
 * Named settlement operations for nested plans, observed suspend work, and DI lazy resolve.
 *
 * Contributor call sites choose one operation directly. Driver-only abort mechanics remain in
 * `abort-settlement.ts`.
 */
export const Settlement = {
  abortOwned: {
    suspend<T>(
      start: (context: RunContext<readonly unknown[]>) => PromiseLike<T>,
    ): SuspendInstruction {
      return new SuspendInstruction((context) => withAbortOwnership(start(context)));
    },
  },

  cooperative: {
    runPlan<T, E, M>(
      plan: Plan<T, E, M>,
      context: RunContext<readonly unknown[]>,
    ): Promise<Result<T, E | UnhandledException>> {
      return runPlan(plan, context, AbortSettlement.passThrough);
    },

    suspendPlan<T, E, M>(plan: Plan<T, E, M>): SuspendInstruction {
      return new SuspendInstruction((context) =>
        runPlan(plan, context, AbortSettlement.passThrough),
      );
    },
  },

  rejecting: {
    awaitWork<T>(work: PromiseLike<T>, signal: AbortSignal): PromiseLike<T> {
      return awaitWithAbort(
        work,
        signal,
        AbortSettlement.rejectOnAbort(() => abortReason(signal)),
      );
    },
  },

  interrupting: {
    runPlan<T, E, M>(
      plan: Plan<T, E, M>,
      context: RunContext<readonly unknown[]>,
    ): Promise<Result<T, E | UnhandledException>> {
      return runPlan(plan, context, interruptOnAbort(context.signal));
    },
  },

  interruptingAndDraining: {
    suspend<T>(
      start: (context: RunContext<readonly unknown[]>) => PromiseLike<T>,
    ): SuspendInstruction {
      return new SuspendInstruction((context) => withAbortDrain(start(context)));
    },

    suspendPlan<T, E, M>(plan: Plan<T, E, M>, mapContext?: MapChildContext): SuspendInstruction {
      return new SuspendInstruction((context) => {
        const mapped = mapContext?.(context) ?? context;
        const work = runPlan(plan, mapped, interruptOnAbort(mapped.signal));
        return withAbortDrain(work);
      });
    },
  },
} as const;
