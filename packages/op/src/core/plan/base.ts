import { UnhandledException } from "../../errors.js";
import type { Op } from "../../index.js";
import { Result } from "../../result.js";
import { unsafeCoerce } from "@prodkit/shared/runtime";
import { isIterableOp } from "../../shared.js";
import {
  CancelSettlement,
  signalAbortReason,
  type CancelSettlement as PlanExecutionMode,
} from "../cancel-session.js";
import { driveIterator } from "../runtime.js";
import type { AsArgs, OpInterface, TrackedErr } from "./surface.js";
import type { RunContext } from "../runtime.js";
import type { Instruction } from "../instructions.js";
import type { EmptyMeta } from "../meta.js";

export const OP_PLAN_BIND: unique symbol = Symbol("prodkit.op.plan-bind");

type PlanInstruction<_E, M> = Instruction<unknown, M>;
type PlanIterator<T, E, M> = Generator<PlanInstruction<E, M>, T, unknown>;

export type { PlanExecutionMode };

export interface Plan<T, E, M = EmptyMeta> {
  readonly execute: (
    context: RunContext<readonly unknown[]>,
    mode?: PlanExecutionMode,
  ) => Promise<Result<T, E | UnhandledException>>;
  readonly iterate: () => PlanIterator<T, E, M>;
  readonly rewrite: <TNext, ENext, MNext>(rewriter: PlanRewriter) => Plan<TNext, ENext, MNext>;
}

export type PlanBinder<T, E, A, M> = (...args: AsArgs<A>) => Plan<T, E, M>;

export type PlanBackedOp<T, E, A, M> = OpInterface<T, E, A, M> & {
  readonly [OP_PLAN_BIND]: PlanBinder<T, E, A, M>;
};

/**
 * Internal rewrite protocol for policy attachment. Built-in policies supply `apply` to wrap leaf
 * plans; wrapper nodes rebuild themselves via `source.rewrite(rewriter)` (see `rewriteUnaryPlan`).
 *
 * When adding a new fluent transform, see "Adding a fluent plan transform" in
 * `docs/contributor/runtime-architecture.md`.
 */
export interface PlanRewriter {
  readonly apply: <T, E, M>(source: Plan<T, E, M>) => Plan<unknown, unknown, unknown>;
}

/** Rebuild a unary wrapper after rewriting its child plan (standard policy push-through). */
export function rewriteUnaryPlan<T, E, M>(
  rewriter: PlanRewriter,
  source: Plan<T, E, M>,
  rebuild: (rewrittenSource: Plan<T, E, M>) => Plan<unknown, unknown, unknown>,
): Plan<unknown, unknown, unknown> {
  return rebuild(source.rewrite(rewriter));
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
    execute: (context, mode) => executePlan(plan, context, mode),
    iterate,
    rewrite: (rewriter) => {
      const rewritten = overrides.rewrite?.(plan, rewriter) ?? rewriter.apply(plan);
      // SAFETY: rewriter.apply loses rewritten generics; the caller's rewriter targets TNext, ENext, MNext.
      return unsafeCoerce(rewritten);
    },
  };
  return plan;
}

export function interruptOnAbortMode(context: RunContext<readonly unknown[]>): PlanExecutionMode {
  return CancelSettlement.interruptOnAbort(() => signalAbortReason(context.signal));
}

export function executePlan<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  mode: PlanExecutionMode = CancelSettlement.passThrough,
): Promise<Result<T, E | UnhandledException>> {
  // SAFETY: driveIterator may return UnhandledException; executePlan widens E for settlement faults.
  return unsafeCoerce(driveIterator(plan.iterate(), context, mode));
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
    // SAFETY: OP_PLAN_BIND return is untyped; isIterableOp proves nullary and the binder matches T, E, M.
    return unsafeCoerce<Plan<T, E, M>>(op[OP_PLAN_BIND]());
  }

  return genPlan(() => op[Symbol.iterator]());
}

export function isPlanBackedOp<T, E, A, M>(
  value: Op<T, E, A, M>,
): value is Op<T, E, A, M> & PlanBackedOp<T, E, A, M> {
  return OP_PLAN_BIND in value;
}
