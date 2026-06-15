import { unsafeCoerce } from "@prodkit/shared/runtime";
import type { Op } from "../index.js";
import type { AsArgs, OpInterface } from "../core/surface.js";
import type { Plan } from "./model.js";

export const OP_PLAN_BIND: unique symbol = Symbol("prodkit.op.plan-bind");

export type PlanBinder<T, E, A, M> = (...args: AsArgs<A>) => Plan<T, E, M>;

export type PlanBackedOp<T, E, A, M> = OpInterface<T, E, A, M> & {
  readonly [OP_PLAN_BIND]: PlanBinder<T, E, A, M>;
};

export function getPlan<T, E, A, M>(op: Op<T, E, A, M>, args: AsArgs<A>): Plan<T, E, M> {
  // SAFETY: Op's public type intentionally hides its internal plan binder.
  const bindPlan = unsafeCoerce<Partial<PlanBackedOp<T, E, A, M>>>(op)[OP_PLAN_BIND];
  if (typeof bindPlan !== "function") {
    throw new TypeError("Expected an Op created by @prodkit/op");
  }
  return bindPlan(...args);
}
