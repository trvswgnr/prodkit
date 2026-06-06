import { abortReason } from "@prodkit/shared/runtime";
import { UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { SuspendInstruction } from "./instructions.js";
import { executePlan, type Plan } from "./plan/base.js";
import type { RunContext } from "./runtime.js";
import {
  type SuspendWork,
  withAbortDrain,
  AbortSettlement as AbortSettlementValues,
  awaitWithAbort,
} from "./settlement.js";

type AbortMode = "passThrough" | "reject" | "interrupt";
type AbortCompletion = "return" | "drain";

type SettlementProfile = {
  readonly key: string;
  readonly launch: AbortMode;
  readonly completion: AbortCompletion;
};

export const SettlementPresets = {
  cooperative: {
    key: "cooperative",
    launch: "passThrough",
    completion: "return",
  },
  rejecting: {
    key: "rejecting",
    launch: "reject",
    completion: "return",
  },
  interrupting: {
    key: "interrupting",
    launch: "interrupt",
    completion: "return",
  },
  interruptingAndDraining: {
    key: "interruptingAndDraining",
    launch: "interrupt",
    completion: "drain",
  },
} as const satisfies Record<string, SettlementProfile>;

type MapChildContext = (parent: RunContext<readonly unknown[]>) => RunContext<readonly unknown[]>;

type SettlementScope = {
  readonly signal: AbortSignal;
  readonly profile: SettlementProfile;

  runPlan<T, E, M>(
    plan: Plan<T, E, M>,
    context: RunContext<readonly unknown[]>,
    mapContext?: MapChildContext,
  ): Promise<Result<T, E | UnhandledException>>;

  observeWork<T>(work: PromiseLike<T>): SuspendWork<T>;

  awaitWork<T>(work: PromiseLike<T>): PromiseLike<T>;
};

function compileScope(profile: SettlementProfile, signal: AbortSignal): SettlementScope {
  const observeWork = <T>(work: PromiseLike<T>): SuspendWork<T> =>
    profile.completion === "drain" ? withAbortDrain(work) : work;

  const runPlan = <T, E, M>(
    plan: Plan<T, E, M>,
    context: RunContext<readonly unknown[]>,
    mapContext?: MapChildContext,
  ): Promise<Result<T, E | UnhandledException>> => {
    const mapped = mapContext?.(context) ?? context;
    const launch =
      profile.launch === "passThrough"
        ? AbortSettlementValues.passThrough
        : profile.launch === "reject"
          ? AbortSettlementValues.rejectOnAbort(() => abortReason(mapped.signal))
          : AbortSettlementValues.interruptOnAbort(() => abortReason(mapped.signal));
    return executePlan(plan, mapped, launch);
  };

  return {
    signal,
    profile,
    runPlan,
    observeWork,
    awaitWork(work) {
      if (profile.launch !== "reject") {
        return work;
      }
      return awaitWithAbort(
        work,
        signal,
        AbortSettlementValues.rejectOnAbort(() => abortReason(signal)),
      );
    },
  };
}

/** Contributor-only nested settlement presets compiled against a run signal. */
export const Settlement = {
  cooperative(signal: AbortSignal): SettlementScope {
    return compileScope(SettlementPresets.cooperative, signal);
  },

  rejecting(signal: AbortSignal): SettlementScope {
    return compileScope(SettlementPresets.rejecting, signal);
  },

  interrupting(signal: AbortSignal): SettlementScope {
    return compileScope(SettlementPresets.interrupting, signal);
  },

  interruptingAndDraining(signal: AbortSignal): SettlementScope {
    return compileScope(SettlementPresets.interruptingAndDraining, signal);
  },

  suspendObservedWork<T>(
    profile: SettlementProfile,
    start: (context: RunContext<readonly unknown[]>) => PromiseLike<T>,
  ): SuspendInstruction {
    return new SuspendInstruction((context) => {
      const scope = compileScope(profile, context.signal);
      return scope.observeWork(start(context));
    });
  },

  suspendPlan<T, E, M>(
    profile: SettlementProfile,
    plan: Plan<T, E, M>,
    mapContext?: MapChildContext,
  ): SuspendInstruction {
    return new SuspendInstruction((context) => {
      const scope = compileScope(profile, context.signal);
      return scope.observeWork(scope.runPlan(plan, context, mapContext));
    });
  },
} as const;
