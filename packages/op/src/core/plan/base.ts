import { UnhandledException } from "../../errors.js";
import type { Op } from "../../index.js";
import { Result } from "../../result.js";
import { isIterableOp, unsafeCoerce } from "../../shared.js";
import { driveIterator } from "../runtime.js";
import type { EnterFn, ExitFn, ReleaseFn } from "./context.js";
import type { AsArgs, OpInterface, TrackedErr } from "./surface.js";
import type { RunContext } from "../runtime.js";
import type { Instruction } from "../instructions.js";
import type { EmptyMeta } from "../meta.js";

export const OP_PLAN_BIND: unique symbol = Symbol("prodkit.op.plan-bind");

type PlanInstruction<_E, M> = Instruction<unknown, M>;
type PlanIterator<T, E, M> = Generator<PlanInstruction<E, M>, T, unknown>;

export interface Plan<T, E, M = EmptyMeta> {
  readonly execute: (
    context: RunContext<readonly unknown[]>,
  ) => Promise<Result<T, E | UnhandledException>>;
  readonly iterate: () => PlanIterator<T, E, M>;
  readonly rewrite: <TNext, ENext, MNext>(rewriter: PlanRewriter) => Plan<TNext, ENext, MNext>;
}

export type PlanBinder<T, E, A, M> = (...args: AsArgs<A>) => Plan<T, E, M>;

export type PlanBackedOp<T, E, A, M> = OpInterface<T, E, A, M> & {
  readonly [OP_PLAN_BIND]: PlanBinder<T, E, A, M>;
};

/**
 * Internal rewrite protocol for policy attachment. Each optional method mirrors a fluent plan
 * transform so built-in policies can rebuild known nodes while preserving ordering semantics.
 *
 * When adding a new fluent transform, see "Adding a fluent plan transform" in CONTRIBUTING.md.
 */
export interface PlanRewriter {
  readonly apply: <T, E, M>(source: Plan<T, E, M>) => Plan<unknown, unknown, unknown>;
  readonly release?: <T, E, M>(
    source: Plan<T, E, M>,
    release: ReleaseFn<T>,
  ) => Plan<unknown, unknown, unknown>;
  readonly enter?: <T, E, A, M>(
    source: Plan<T, E, M>,
    initialize: EnterFn<A>,
  ) => Plan<unknown, unknown, unknown>;
  readonly exit?: <T, E, A, M>(
    source: Plan<T, E, M>,
    finalize: ExitFn<T, E, A>,
  ) => Plan<unknown, unknown, unknown>;
  readonly map?: <T, E, U, M>(
    source: Plan<T, E, M>,
    transform: (value: T) => U,
  ) => Plan<unknown, unknown, unknown>;
  readonly tap?: <T, E, R, M>(
    source: Plan<T, E, M>,
    observe: (value: T) => R,
  ) => Plan<unknown, unknown, unknown>;
  readonly mapErr?: <T, E, E2, M>(
    source: Plan<T, E, M>,
    transform: (error: TrackedErr<E>) => E2,
  ) => Plan<unknown, unknown, unknown>;
  readonly tapErr?: <T, E, R, M>(
    source: Plan<T, E, M>,
    observe: (error: TrackedErr<E>) => R,
  ) => Plan<unknown, unknown, unknown>;
  readonly recover?: <T, E, ECaught extends TrackedErr<E>, R, M>(
    source: Plan<T, E, M>,
    predicate: (error: TrackedErr<E>) => error is ECaught,
    handler: (error: ECaught) => R,
  ) => Plan<unknown, unknown, unknown>;
}

interface PlanRewriteOverrides<T, E, M> {
  readonly rewrite?: (
    self: Plan<T, E, M>,
    rewriter: PlanRewriter,
  ) => Plan<unknown, unknown, unknown>;
}

export function createPlan<T, E, M>(
  iterate: () => PlanIterator<T, E, M>,
  overrides: PlanRewriteOverrides<T, E, M> = {},
): Plan<T, E, M> {
  const plan: Plan<T, E, M> = {
    execute: (context) => executePlan(plan, context),
    iterate,
    rewrite: (rewriter) => {
      const rewritten = overrides.rewrite?.(plan, rewriter) ?? rewriter.apply(plan);
      // SAFETY: PlanRewriter is an internal generic rewrite protocol. Callers choose the typed
      // target when they supply the matching rewriter from the policy layer.
      return unsafeCoerce(rewritten);
    },
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
    // SAFETY: the iterable guard proves the public op is nullary for this branch; the plan-backed
    // binder was installed on the same branded Op value and returns the matching plan shape.
    return unsafeCoerce<Plan<T, E, M>>(op[OP_PLAN_BIND]());
  }

  return genPlan(() => op[Symbol.iterator]());
}

export function isPlanBackedOp<T, E, A, M>(
  value: Op<T, E, A, M>,
): value is Op<T, E, A, M> & PlanBackedOp<T, E, A, M> {
  return OP_PLAN_BIND in value;
}
