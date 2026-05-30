import { TimeoutError, UnhandledException } from "../../errors.js";
import type { Op } from "../../index.js";
import { Result } from "../../result.js";
import { isIterableOp, unsafeCoerce } from "../../shared.js";
import { driveIterator } from "../runtime.js";
import { normalizeRetryPolicy, type NormalizedRetryPolicy } from "../retry-policy.js";
import type {
  AsArgs,
  EmptyMeta,
  Instruction,
  OpInterface,
  RunContext,
  TrackedErr,
} from "../types.js";
import { retryPlan, signalPlan, timeoutPlan } from "./policies.js";

export const OP_PLAN_BIND: unique symbol = Symbol("prodkit.op.plan-bind");

type PlanInstruction<_E, M> = Instruction<unknown, M>;
type PlanIterator<T, E, M> = Generator<PlanInstruction<E, M>, T, unknown>;

export interface Plan<T, E, M = EmptyMeta> {
  readonly execute: (
    context: RunContext<readonly unknown[]>,
  ) => Promise<Result<T, E | UnhandledException>>;
  readonly iterate: () => PlanIterator<T, E, M>;
  readonly withRetry: (policy?: NormalizedRetryPolicy) => Plan<T, E, M>;
  readonly withTimeout: (timeoutMs: number) => Plan<T, E | TimeoutError, M>;
  readonly withSignal: (signal: AbortSignal) => Plan<T, E, M>;
}

export type PlanBinder<T, E, A, M> = (...args: AsArgs<A>) => Plan<T, E, M>;

export type PlanBackedOp<T, E, A, M> = OpInterface<T, E, A, M> & {
  readonly [OP_PLAN_BIND]: PlanBinder<T, E, A, M>;
};

interface PlanPolicyOverrides<T, E, M> {
  readonly withRetry?: (policy?: NormalizedRetryPolicy) => Plan<T, E, M>;
  readonly withTimeout?: (timeoutMs: number) => Plan<T, E | TimeoutError, M>;
  readonly withSignal?: (signal: AbortSignal) => Plan<T, E, M>;
}

export function createPlan<T, E, M>(
  iterate: () => PlanIterator<T, E, M>,
  overrides: PlanPolicyOverrides<T, E, M> = {},
): Plan<T, E, M> {
  const plan: Plan<T, E, M> = {
    execute: (context) => executePlan(plan, context),
    iterate,
    withRetry:
      overrides.withRetry ?? ((policy = normalizeRetryPolicy()) => retryPlan(plan, policy)),
    withTimeout: overrides.withTimeout ?? ((timeoutMs) => timeoutPlan(plan, timeoutMs)),
    withSignal: overrides.withSignal ?? ((signal) => signalPlan(plan, signal)),
  };
  return plan;
}

export function executePlan<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>> {
  // SAFETY: plan constructors type their public error channel on Plan<T, E>; the shared
  // generator driver also appends UnhandledException for runtime faults.
  return unsafeCoerce(driveIterator(plan.iterate(), context));
}

export function executePlanInterruptOnAbort<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>> {
  // SAFETY: interrupt mode changes cancellation behavior, not the plan's typed error channel.
  return unsafeCoerce(driveIterator(plan.iterate(), context, true));
}

export function genPlan<T, E, M>(
  gen: () => Generator<Instruction<E, M>, T, unknown>,
): Plan<T, TrackedErr<E>, M> {
  return createPlan(() => gen());
}

export function getPlan<T, E, A, M>(op: Op<T, E, A, M>, args: AsArgs<A>): Plan<T, E, M> {
  if (isPlanBackedOp(op)) {
    return op[OP_PLAN_BIND](...args);
  }

  return genPlan(() => op(...args)[Symbol.iterator]());
}

export function getIterablePlan<T, E, M>(op: Op<T, E, [], M>): Plan<T, E, M> | undefined {
  if (!isIterableOp(op)) return undefined;

  if (isPlanBackedOp(op)) {
    // SAFETY: isPlanBackedOp narrows to PlanBackedOp, but OP_PLAN_BIND's return is erased at the call site.
    return op[OP_PLAN_BIND]();
  }

  return genPlan(() => op[Symbol.iterator]());
}

export function isPlanBackedOp<T, E, A, M>(
  value: Op<T, E, A, M>,
): value is Op<T, E, A, M> & PlanBackedOp<T, E, A, M> {
  return OP_PLAN_BIND in value;
}
