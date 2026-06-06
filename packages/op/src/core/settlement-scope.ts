import { abortReason } from "@prodkit/shared/runtime";
import { UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { SuspendInstruction } from "./instructions.js";
import { executePlan, type Plan } from "./plan/base.js";
import type { RunContext } from "./runtime.js";
import {
  type SuspendWork,
  withAbortDrain,
  type AbortSettlement,
  AbortSettlement as AbortSettlementValues,
  awaitWithAbort,
} from "./settlement.js";

type AbortMode = "passThrough" | "reject" | "interrupt";
type AbortCompletion = "return" | "drain";

/** Contributor-only launch/observe intent for nested plan and suspend work. */
export type SettlementProfile = {
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

type SettlementPresetName = keyof typeof SettlementPresets;

type MapChildContext = (parent: RunContext<readonly unknown[]>) => RunContext<readonly unknown[]>;

type RunPlanOptions = {
  readonly mapContext?: MapChildContext;
};

/** Signal-bound compiled settlement preset for nested plan execution. */
export type SettlementScope = {
  readonly signal: AbortSignal;
  readonly profile: SettlementProfile;

  runPlan<T, E, M>(
    plan: Plan<T, E, M>,
    context: RunContext<readonly unknown[]>,
    options?: RunPlanOptions,
  ): Promise<Result<T, E | UnhandledException>>;

  suspendPlan<T, E, M>(plan: Plan<T, E, M>, options?: RunPlanOptions): SuspendInstruction;

  suspendObservedWork<T>(
    start: (context: RunContext<readonly unknown[]>) => PromiseLike<T>,
  ): SuspendInstruction;

  observeWork<T>(work: PromiseLike<T>): SuspendWork<T>;

  awaitWork<T>(work: PromiseLike<T>): PromiseLike<T>;
};

function launchSettlement(mode: AbortMode, signal: AbortSignal): AbortSettlement {
  switch (mode) {
    case "passThrough":
      return AbortSettlementValues.passThrough;
    case "reject":
      return AbortSettlementValues.rejectOnAbort(() => abortReason(signal));
    case "interrupt":
      return AbortSettlementValues.interruptOnAbort(() => abortReason(signal));
  }
}

function compileScope(profile: SettlementProfile, signal: AbortSignal): SettlementScope {
  const observeWork = <T>(work: PromiseLike<T>): SuspendWork<T> =>
    profile.completion === "drain" ? withAbortDrain(work) : work;

  const runPlan = <T, E, M>(
    plan: Plan<T, E, M>,
    context: RunContext<readonly unknown[]>,
    options?: RunPlanOptions,
  ): Promise<Result<T, E | UnhandledException>> => {
    const mapped = options?.mapContext?.(context) ?? context;
    return executePlan(plan, mapped, launchSettlement(profile.launch, mapped.signal));
  };

  return {
    signal,
    profile,
    runPlan,
    observeWork,
    suspendPlan(plan, options) {
      return new SuspendInstruction((parentContext) =>
        observeWork(runPlan(plan, parentContext, options)),
      );
    },
    suspendObservedWork(start) {
      return new SuspendInstruction((parentContext) => observeWork(start(parentContext)));
    },
    awaitWork(work) {
      if (profile.launch !== "reject") {
        return work;
      }
      return awaitWithAbort(work, signal, launchSettlement("reject", signal));
    },
  };
}

function scopeForPreset(preset: SettlementPresetName, signal: AbortSignal): SettlementScope {
  return compileScope(SettlementPresets[preset], signal);
}

/** Contributor-only nested settlement presets compiled against a run signal. */
export const Settlement = {
  cooperative(signal: AbortSignal): SettlementScope {
    return scopeForPreset("cooperative", signal);
  },

  rejecting(signal: AbortSignal): SettlementScope {
    return scopeForPreset("rejecting", signal);
  },

  interrupting(signal: AbortSignal): SettlementScope {
    return scopeForPreset("interrupting", signal);
  },

  interruptingAndDraining(signal: AbortSignal): SettlementScope {
    return scopeForPreset("interruptingAndDraining", signal);
  },

  suspendObservedWork<T>(
    profile: SettlementProfile,
    start: (context: RunContext<readonly unknown[]>) => PromiseLike<T>,
  ): SuspendInstruction {
    return new SuspendInstruction((context) =>
      compileScope(profile, context.signal).observeWork(start(context)),
    );
  },

  suspendPlan<T, E, M>(
    profile: SettlementProfile,
    plan: Plan<T, E, M>,
    options?: RunPlanOptions,
  ): SuspendInstruction {
    return new SuspendInstruction((context) => {
      const scope = compileScope(profile, context.signal);
      return scope.observeWork(scope.runPlan(plan, context, options));
    });
  },
} as const;
