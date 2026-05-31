import type { RetryPolicy } from "./retry-policy.js";
import type { ReleaseFn, RunContext } from "../core/types.js";
import type { TimeoutError, UnhandledException } from "../errors.js";
import type { HKT } from "../hkt.js";
import type { Op } from "../index.js";
import type { Plan, PlanRewriter } from "../core/plan/base.js";
import type { Result } from "../result.js";
import { unsafeCoerce } from "../shared.js";

export const OP_POLICY = Symbol("prodkit.op.policy");
export const OP_POLICY_INPUT = Symbol("prodkit.op.policy.input");

export interface OpPolicyType extends HKT {
  readonly [HKT.TYPE]: Op<
    HKT.Param<this, 0>,
    HKT.Param<this, 1>,
    HKT.Param<this, 2>,
    HKT.Param<this, 3>
  >;
}

export type ApplyOpPolicy<F extends HKT, T, E, A, M> = HKT.Apply<F, readonly [T, E, A, M]>;

export type OpPolicyResult<F extends HKT, T, E, A, M> = ApplyOpPolicy<F, T, E, A, M>;

export interface OpPolicyInput<T = unknown, E = unknown, A = unknown, M = unknown> {
  readonly ok: T;
  readonly err: E;
  readonly args: A;
  readonly meta: M;
}

export interface OpPolicySource<T, E, A, M> {
  wrap<TNext, ENext, MNext>(
    transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
  ): Op<TNext, ENext, A, MNext>;
  rewrite<TNext, ENext, MNext>(rewriter: PlanRewriter): Op<TNext, ENext, A, MNext>;
  around<TNext, ENext, MNext = M>(
    run: (
      next: (context: RunContext<readonly unknown[]>) => Promise<Result<T, E | UnhandledException>>,
      context: RunContext<readonly unknown[]>,
    ) => PromiseLike<Result<TNext, ENext | UnhandledException>>,
  ): Op<TNext, ENext, A, MNext>;
}

export interface OpPolicy<Input = unknown, F extends HKT = OpPolicyType> {
  readonly [OP_POLICY]: F;
  readonly [OP_POLICY_INPUT]?: (input: Input) => void;
  apply<T, E, A, M>(source: OpPolicySource<T, E, A, M>): OpPolicyResult<F, T, E, A, M>;
}

/**
 * Builds a custom policy value for `.with(Policy.define(...))`.
 * Use `source.wrap`, `source.rewrite`, or `source.around` inside `apply` to transform the wrapped op.
 */
export function define<Input, F extends HKT, Extras extends object = Record<never, never>>(
  definition: Extras & {
    apply<T, E, A, M>(source: OpPolicySource<T, E, A, M>): OpPolicyResult<F, T, E, A, M>;
  },
): OpPolicy<Input, F> & Extras {
  Object.defineProperty(definition, OP_POLICY, { value: undefined });
  // SAFETY: we know the definition is a valid OpPolicy<Input, F> & Extras
  return unsafeCoerce(definition);
}

export interface TimeoutPolicyType extends HKT {
  readonly [HKT.TYPE]: Op<
    HKT.Param<this, 0>,
    HKT.Param<this, 1> | TimeoutError,
    HKT.Param<this, 2>,
    HKT.Param<this, 3>
  >;
}

export type RetryPolicyAttachment = OpPolicy<unknown, OpPolicyType> & {
  readonly policy: RetryPolicy | undefined;
};

export type TimeoutPolicyAttachment = OpPolicy<unknown, TimeoutPolicyType> & {
  readonly timeoutMs: number;
};

export type CancelPolicyAttachment = OpPolicy<unknown, OpPolicyType> & {
  readonly abortSignal: AbortSignal;
};

export type ReleasePolicyAttachment<T> = OpPolicy<OpPolicyInput<T>, OpPolicyType> & {
  readonly release: ReleaseFn<T>;
};

export type BuiltInPolicy<T = unknown> =
  | RetryPolicyAttachment
  | TimeoutPolicyAttachment
  | CancelPolicyAttachment
  | ReleasePolicyAttachment<T>;
