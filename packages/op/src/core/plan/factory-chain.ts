import { splitLeadingUnaryWraps, type Plan } from "./base.js";

export type ErasedPlan = Plan<unknown, unknown, unknown>;
export type ErasedPlanFactory = (...args: readonly unknown[]) => ErasedPlan;
export type ErasedPlanTransform = (plan: ErasedPlan) => ErasedPlan;
const PLAN_FACTORY_CHAIN: unique symbol = Symbol("prodkit.op.plan-factory-chain");

export type TransformKind = "unaryWrap" | "pushPolicy" | "boundary";
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

  // When a push-through policy is present and the entry plan is itself a deep unary chain (for
  // example an already-folded op reached through `getPlan`/`invoke`), split the entry plan's leading
  // unary wrappers up front. That keeps `base` shallow so each `pushPolicy` rewrites it in O(1)
  // instead of re-walking and rebuilding the entry chain per policy. A shallow (non-unary) entry
  // short-circuits the split in O(1), so the common case is unaffected.
  if (hasPushPolicy) {
    const split = splitLeadingUnaryWraps(source);
    base = split.base;
    for (const wrap of split.wraps) pendingUnaryWraps.push(wrap);
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
      // transform(base) is base.rewrite(rewriter); with deferred wraps, base is the nearest
      // non-unary node, which is exactly the push-through target.
      base = node.transform(base);
      continue;
    }

    // boundary
    materialize();
    base = node.transform(base);
  }

  materialize();
  return base;
}
