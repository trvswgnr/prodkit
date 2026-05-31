import type { RetryPolicy } from "./retry-policy.js";
import type { ReleaseFn, RunContext } from "../core/types.js";
import type { TimeoutError, UnhandledException } from "../errors.js";
import { HKT_RESULT } from "../hkt.js";
import type { Apply, HKT, HKTArg } from "../hkt.js";
import type { Op } from "../index.js";
import type { Plan, PlanRewriter } from "../core/plan/base.js";
import type { Result } from "../result.js";
import { unsafeCoerce } from "../shared.js";

export const OP_POLICY = Symbol("prodkit.op.policy");
export const OP_POLICY_INPUT = Symbol("prodkit.op.policy.input");

export type OpPolicyArgs<T = unknown, E = unknown, A = unknown, M = unknown> = [
  ok: T,
  err: E,
  args: A,
  meta: M,
];

export interface OpPolicyType extends HKT {
  readonly [HKT_RESULT]: OpPolicyArgs;
}

export type OpPolicyArg<Self, Index extends keyof OpPolicyArgs> = HKTArg<Self, Index>;

export type ApplyOpPolicy<F extends OpPolicyType, T, E, A, M> = Apply<F, OpPolicyArgs<T, E, A, M>>;

export type OpPolicyResult<F extends OpPolicyType, T, E, A, M> = Op<
  ApplyOpPolicy<F, T, E, A, M>[0],
  ApplyOpPolicy<F, T, E, A, M>[1],
  ApplyOpPolicy<F, T, E, A, M>[2],
  ApplyOpPolicy<F, T, E, A, M>[3]
>;

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

export interface OpPolicy<Input = unknown, F extends OpPolicyType = OpPolicyType> {
  readonly [OP_POLICY]: F;
  readonly [OP_POLICY_INPUT]?: (input: Input) => void;
  apply<T, E, A, M>(source: OpPolicySource<T, E, A, M>): OpPolicyResult<F, T, E, A, M>;
}

/**
 * Builds a custom policy value for `op.with(...)`.
 * Use `source.wrap`, `source.rewrite`, or `source.around` inside `apply` to transform the wrapped op.
 */
export function define<Input, F extends OpPolicyType, Extras extends object = Record<never, never>>(
  definition: Extras & {
    apply<T, E, A, M>(source: OpPolicySource<T, E, A, M>): OpPolicyResult<F, T, E, A, M>;
  },
): OpPolicy<Input, F> & Extras {
  Object.defineProperty(definition, OP_POLICY, { value: undefined });
  // SAFETY: we know the definition is a valid OpPolicy<Input, F> & Extras
  return unsafeCoerce(definition);
}

export interface RetryPolicyType extends OpPolicyType {
  readonly [HKT_RESULT]: OpPolicyArgs<
    OpPolicyArg<this, 0>,
    OpPolicyArg<this, 1>,
    OpPolicyArg<this, 2>,
    OpPolicyArg<this, 3>
  >;
}

export interface TimeoutPolicyType extends OpPolicyType {
  readonly [HKT_RESULT]: OpPolicyArgs<
    OpPolicyArg<this, 0>,
    OpPolicyArg<this, 1> | TimeoutError,
    OpPolicyArg<this, 2>,
    OpPolicyArg<this, 3>
  >;
}

export interface CancelPolicyType extends OpPolicyType {
  readonly [HKT_RESULT]: OpPolicyArgs<
    OpPolicyArg<this, 0>,
    OpPolicyArg<this, 1>,
    OpPolicyArg<this, 2>,
    OpPolicyArg<this, 3>
  >;
}

export interface ReleasePolicyType extends OpPolicyType {
  readonly [HKT_RESULT]: OpPolicyArgs<
    OpPolicyArg<this, 0>,
    OpPolicyArg<this, 1>,
    OpPolicyArg<this, 2>,
    OpPolicyArg<this, 3>
  >;
}

export type RetryPolicyAttachment = OpPolicy<unknown, RetryPolicyType> & {
  readonly policy: RetryPolicy | undefined;
};

export type TimeoutPolicyAttachment = OpPolicy<unknown, TimeoutPolicyType> & {
  readonly timeoutMs: number;
};

export type CancelPolicyAttachment = OpPolicy<unknown, CancelPolicyType> & {
  readonly abortSignal: AbortSignal;
};

export type ReleasePolicyAttachment<T> = OpPolicy<OpPolicyInput<T>, ReleasePolicyType> & {
  readonly release: ReleaseFn<T>;
};

export type BuiltInPolicy<T = unknown> =
  | RetryPolicyAttachment
  | TimeoutPolicyAttachment
  | CancelPolicyAttachment
  | ReleasePolicyAttachment<T>;
