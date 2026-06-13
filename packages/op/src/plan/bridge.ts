import { unsafeCoerce } from "@prodkit/shared/runtime";
import type { Op } from "../index.js";
import { isIterableOp } from "../core/identity.js";
import type { AsArgs, OpInterface } from "../core/surface.js";
import { genPlan, type Plan } from "./model.js";

export const OP_PLAN_BIND: unique symbol = Symbol("prodkit.op.plan-bind");

export type PlanBinder<T, E, A, M> = (...args: AsArgs<A>) => Plan<T, E, M>;

export type PlanBackedOp<T, E, A, M> = OpInterface<T, E, A, M> & {
  readonly [OP_PLAN_BIND]: PlanBinder<T, E, A, M>;
};

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
