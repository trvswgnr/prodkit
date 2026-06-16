import { UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { unsafeCoerce } from "@prodkit/shared/runtime";
import type { TrackedErr } from "../core/surface.js";
import { executePlan, type RunContext } from "../execution/runtime.js";
import type { RuntimeInstruction } from "../execution/instructions.js";
import type { AbortSettlement } from "../execution/abort-settlement.js";
import type { EmptyMeta } from "../core/metadata.js";

const PLAN_UNARY_REWRITE: unique symbol = Symbol("prodkit.op.plan-unary-rewrite");
const PLAN_FACTORY_CHAIN: unique symbol = Symbol("prodkit.op.plan-factory-chain");

type PlanInstruction<_E, M> = RuntimeInstruction<unknown, M>;
type PlanIterator<T, E, M> = Generator<PlanInstruction<E, M>, T, unknown>;
type ErasedPlan = Plan<unknown, unknown, unknown>;
export type ErasedPlanFactory = (...args: readonly unknown[]) => ErasedPlan;
export type ErasedPlanTransform = (plan: ErasedPlan) => ErasedPlan;
export type TransformKind = "unaryWrap" | "pushPolicy" | "boundary";

type UnaryPlanRewrite = {
  readonly source: ErasedPlan;
  readonly rebuild: (rewrittenSource: ErasedPlan) => ErasedPlan;
};
type PlanTransformNode = {
  readonly previous: PlanTransformNode | undefined;
  readonly transform: ErasedPlanTransform;
  readonly kind: TransformKind;
};
type PlanFactoryChain = {
  readonly base: ErasedPlanFactory;
  readonly tail: PlanTransformNode | undefined;
};
type ChainablePlanFactory = ErasedPlanFactory & {
  readonly [PLAN_FACTORY_CHAIN]?: PlanFactoryChain;
};

export interface Plan<T, E, M = EmptyMeta> {
  readonly execute: (
    context: RunContext<readonly unknown[]>,
    settlement?: AbortSettlement,
  ) => Promise<Result<T, E | UnhandledException>>;
  readonly [PLAN_UNARY_REWRITE]?: UnaryPlanRewrite;
  readonly iterate: () => PlanIterator<T, E, M>;
  readonly rewrite: <TNext, ENext, MNext>(rewriter: PlanRewriter) => Plan<TNext, ENext, MNext>;
}

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
  const rewritten = rewriteUnaryPlanChain(erasedSource, rewriter);
  // SAFETY: rewriteUnaryPlanChain rewrites the same source slot captured by this unary wrapper.
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
    execute: (context, settlement) => executePlan(plan, context, settlement),
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
  // SAFETY: unary rewrite metadata is intentionally erased so one iterative walk can collect heterogenous frames.
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

type UnaryWrapWalk = {
  readonly base: ErasedPlan;
  /** innermost-first rebuild callbacks (fluent call order) */
  readonly rebuilds: ReadonlyArray<UnaryPlanRewrite["rebuild"]>;
};

function walkUnaryWraps(plan: ErasedPlan): UnaryWrapWalk {
  const collected: UnaryPlanRewrite["rebuild"][] = [];
  let current = plan;

  while (true) {
    const unary = current[PLAN_UNARY_REWRITE];
    if (unary === undefined) break;
    collected.push(unary.rebuild);
    current = unary.source;
  }

  collected.reverse();
  return { base: current, rebuilds: collected };
}

function rebuildUnaryWraps(
  base: ErasedPlan,
  rebuilds: readonly UnaryPlanRewrite["rebuild"][],
  rewriteBase: (plan: ErasedPlan) => ErasedPlan,
): ErasedPlan {
  let rebuilt = rewriteBase(base);
  for (const rebuild of rebuilds) {
    rebuilt = rebuild(rebuilt);
  }
  return rebuilt;
}

export function appendPlanTransform(
  factory: ErasedPlanFactory,
  transform: ErasedPlanTransform,
  kind: TransformKind,
): ErasedPlanFactory {
  const chain = getPlanFactoryChain(factory);
  const tail: PlanTransformNode = { previous: chain.tail, transform, kind };
  const next: ErasedPlanFactory = (...args) => applyPlanTransforms(chain.base(...args), tail);
  Object.defineProperty(next, PLAN_FACTORY_CHAIN, {
    value: { base: chain.base, tail } satisfies PlanFactoryChain,
  });
  return next;
}

function getPlanFactoryChain(factory: ErasedPlanFactory): PlanFactoryChain {
  const chainable: ChainablePlanFactory = factory;
  return chainable[PLAN_FACTORY_CHAIN] ?? { base: factory, tail: undefined };
}

function applyPlanTransforms(source: ErasedPlan, tail: PlanTransformNode): ErasedPlan {
  const nodes: PlanTransformNode[] = [];
  let hasPushPolicy = false;
  for (let node: PlanTransformNode | undefined = tail; node !== undefined; node = node.previous) {
    nodes.push(node);
    if (node.kind === "pushPolicy") hasPushPolicy = true;
  }

  let base = source;
  const pendingUnaryWraps: ErasedPlanTransform[] = [];

  // Normalize an already-materialized unary entry once so stacked push-through policies do not
  // repeatedly walk and rebuild the same prefix.
  if (hasPushPolicy) {
    const { base: unaryBase, rebuilds } = walkUnaryWraps(source);
    base = unaryBase;
    for (const wrap of rebuilds) pendingUnaryWraps.push(wrap);
  }

  const materialize = () => {
    for (let index = 0; index < pendingUnaryWraps.length; index += 1) {
      const wrap = pendingUnaryWraps[index];
      if (wrap !== undefined) base = wrap(base);
    }
    pendingUnaryWraps.length = 0;
  };

  // nodes is tail..head; iterate head..tail to apply transforms in fluent-call order.
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node === undefined) continue;

    if (node.kind === "unaryWrap") {
      pendingUnaryWraps.push(node.transform);
      continue;
    }

    if (node.kind === "pushPolicy") {
      // Deferred unary wraps leave base at the nearest non-unary policy target.
      base = node.transform(base);
      continue;
    }

    materialize();
    base = node.transform(base);
  }

  materialize();
  return base;
}

function rewriteUnaryPlanChain(source: ErasedPlan, rewriter: PlanRewriter): ErasedPlan {
  const walk = walkUnaryWraps(source);
  return rebuildUnaryWraps(walk.base, walk.rebuilds, (base) => base.rewrite(rewriter));
}

export function genPlan<T, E, M>(
  gen: () => Generator<RuntimeInstruction<E, M>, T, unknown>,
): Plan<T, TrackedErr<E>, M> {
  return createPlan(() => gen());
}
