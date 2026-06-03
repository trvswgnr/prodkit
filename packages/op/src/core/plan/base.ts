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
const PLAN_UNARY_REWRITE: unique symbol = Symbol("prodkit.op.plan-unary-rewrite");

type PlanInstruction<_E, M> = Instruction<unknown, M>;
type PlanIterator<T, E, M> = Generator<PlanInstruction<E, M>, T, unknown>;
type ErasedPlan = Plan<unknown, unknown, unknown>;
type UnaryPlanRewrite = {
  readonly source: ErasedPlan;
  readonly rebuild: (rewrittenSource: ErasedPlan) => ErasedPlan;
};
type PlanExecutionJob = {
  readonly plan: ErasedPlan;
  readonly context: RunContext<readonly unknown[]>;
  readonly mode: PlanExecutionMode;
  readonly resolve: (result: Result<unknown, unknown | UnhandledException>) => void;
  readonly reject: (cause: unknown) => void;
};

export type { PlanExecutionMode };

export interface Plan<T, E, M = EmptyMeta> {
  readonly execute: (
    context: RunContext<readonly unknown[]>,
    mode?: PlanExecutionMode,
  ) => Promise<Result<T, E | UnhandledException>>;
  readonly [PLAN_UNARY_REWRITE]?: UnaryPlanRewrite;
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
  // SAFETY: rewrite metadata erases source generics; the caller-owned rebuild restores the wrapper-local source type.
  const erasedSource: ErasedPlan = unsafeCoerce(source);
  const rewritten = rewritePlanStackSafe(erasedSource, rewriter);
  // SAFETY: rewritePlanStackSafe rewrites the same source slot captured by this unary wrapper.
  const typedRewritten: Plan<T, E, M> = unsafeCoerce(rewritten);
  return rebuild(typedRewritten);
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

export function createUnaryPlan<T, E, M, TSource, ESource, MSource>(
  iterate: () => PlanIterator<T, E, M>,
  source: Plan<TSource, ESource, MSource>,
  rebuild: (rewrittenSource: Plan<TSource, ESource, MSource>) => Plan<unknown, unknown, unknown>,
): Plan<T, E, M> {
  // SAFETY: unary rewrite metadata is intentionally erased so stack-safe rewrite can collect heterogenous frames.
  const erasedSource: ErasedPlan = unsafeCoerce(source);
  const erasedRebuild: UnaryPlanRewrite["rebuild"] = (rewrittenSource) => {
    // SAFETY: rewrittenSource is produced by rewriting the same source slot captured above.
    const typedSource: Plan<TSource, ESource, MSource> = unsafeCoerce(rewrittenSource);
    return rebuild(typedSource);
  };
  const plan = createPlan(iterate, {
    rewrite: (_self, rewriter) => rewriteUnaryPlan(rewriter, source, rebuild),
  });
  Object.defineProperty(plan, PLAN_UNARY_REWRITE, {
    value: { source: erasedSource, rebuild: erasedRebuild } satisfies UnaryPlanRewrite,
  });
  return plan;
}

function rewritePlanStackSafe(source: ErasedPlan, rewriter: PlanRewriter): ErasedPlan {
  const rebuilds: UnaryPlanRewrite["rebuild"][] = [];
  let current = source;

  while (true) {
    const unary = current[PLAN_UNARY_REWRITE];
    if (unary === undefined) break;
    rebuilds.push(unary.rebuild);
    current = unary.source;
  }

  let rewritten = current.rewrite(rewriter);
  for (let index = rebuilds.length - 1; index >= 0; index -= 1) {
    const rebuild = rebuilds[index];
    if (rebuild !== undefined) rewritten = rebuild(rewritten);
  }
  return rewritten;
}

export function interruptOnAbortMode(context: RunContext<readonly unknown[]>): PlanExecutionMode {
  return CancelSettlement.interruptOnAbort(() => signalAbortReason(context.signal));
}

let activePlanExecutionCount = 0;
const planExecutionQueue: PlanExecutionJob[] = [];
let planExecutionPumpScheduled = false;
const MAX_SYNC_PLAN_EXECUTION_DEPTH = 128;

export function executePlan<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  mode: PlanExecutionMode = CancelSettlement.passThrough,
): Promise<Result<T, E | UnhandledException>> {
  if (activePlanExecutionCount < MAX_SYNC_PLAN_EXECUTION_DEPTH) {
    return executePlanDirect(plan, context, mode);
  }

  return enqueuePlanExecution(plan, context, mode);
}

async function executePlanDirect<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  mode: PlanExecutionMode,
): Promise<Result<T, E | UnhandledException>> {
  activePlanExecutionCount += 1;
  try {
    // SAFETY: driveIterator may return UnhandledException; executePlan widens E for settlement faults.
    return unsafeCoerce(await driveIterator(plan.iterate(), context, mode));
  } finally {
    activePlanExecutionCount -= 1;
  }
}

function enqueuePlanExecution<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  mode: PlanExecutionMode,
): Promise<Result<T, E | UnhandledException>> {
  return new Promise((resolve, reject) => {
    // SAFETY: queued jobs erase plan generics and restore them through the typed promise returned by executePlan.
    const erasedPlan: ErasedPlan = unsafeCoerce(plan);
    // SAFETY: the queued result is the same Result shape, with generics erased at the queue boundary only.
    const erasedResolve: PlanExecutionJob["resolve"] = unsafeCoerce(resolve);
    planExecutionQueue.push({
      plan: erasedPlan,
      context,
      mode,
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

    void executePlanDirect(job.plan, job.context, job.mode).then(job.resolve, job.reject);
  }
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
