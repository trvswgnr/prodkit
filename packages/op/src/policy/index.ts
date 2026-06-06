import { unsafeCoerce } from "@prodkit/shared/runtime";
import { define } from "./types.js";
import { cancelRewriter, releasePlan, retryRewriter, timeoutRewriter } from "./plan.js";
import { Delay, normalizeRetryPolicy } from "./retry-policy.js";
import type {
  BuiltInPolicy,
  CancelPolicyAttachment,
  OpPolicy,
  OpPolicyInput,
  OpPolicySource,
  OpPolicyType,
  ReleasePolicyAttachment,
  RetryPolicyAttachment,
  TimeoutPolicyAttachment,
  TimeoutPolicyType,
} from "./types.js";
import type { ExponentialDelayOptions, RetryPolicy } from "./retry-policy.js";
import type { ReleaseFn } from "../core/lifecycle.js";
import type { HKT } from "../hkt.js";

function retry(policy?: RetryPolicy): RetryPolicyAttachment {
  const rewriter = retryRewriter(normalizeRetryPolicy(policy));
  return define<unknown, OpPolicyType, { readonly policy: RetryPolicy | undefined }>({
    policy,
    apply: (source) => source.rewrite(rewriter),
  });
}

function timeout(timeoutMs: number): TimeoutPolicyAttachment {
  const rewriter = timeoutRewriter(timeoutMs);
  return define<unknown, TimeoutPolicyType, { readonly timeoutMs: number }>({
    timeoutMs,
    apply: (source) => source.rewrite(rewriter),
  });
}

function cancel(abortSignal: AbortSignal): CancelPolicyAttachment {
  const rewriter = cancelRewriter(abortSignal);
  return define<unknown, OpPolicyType, { readonly abortSignal: AbortSignal }>({
    abortSignal,
    apply: (source) => source.rewrite(rewriter),
  });
}

function release<T>(releaseFn: ReleaseFn<T>): ReleasePolicyAttachment<T> {
  // SAFETY: wrap cannot prove ReleaseFn<T> matches plan T; release is only called with result.value after success.
  const releaseForPlan: ReleaseFn<unknown> = unsafeCoerce(releaseFn);
  return define<OpPolicyInput<T>, OpPolicyType, { readonly release: ReleaseFn<T> }>({
    release: releaseFn,
    apply: (source) => source.wrap((plan) => releasePlan(plan, releaseForPlan)),
  });
}

/** Built-in and custom policy constructors for `.with(...)`. */
export const Policy = {
  /** Creates a retry policy attachment for `.with(Policy.retry(...))`. Uses default `retries: 2` when omitted. */
  retry,
  /** Creates a timeout policy attachment for `.with(Policy.timeout(...))`. */
  timeout,
  /** Creates a cancellation policy attachment for `.with(Policy.cancel(...))`. */
  cancel,
  /** Creates a release policy attachment for `.with(Policy.release(...))`. */
  release,
  /** Builds a custom policy value for `.with(Policy.define(...))`. */
  define,
} as const;

/** Policy attachment for `.with(...)`. Custom factories return `Policy<Input, YourPolicyHKT>`. */
export type Policy<Input = unknown, F extends HKT = OpPolicyType> = OpPolicy<Input, F>;

/** Nested type helpers for custom `Policy.define(...)` authors. */
export namespace Policy {
  /** Contravariant input phantom; enables contextual typing for `Policy.release((value) => ...)`. */
  export type Input<T = unknown, E = unknown, A = unknown, M = unknown> = OpPolicyInput<T, E, A, M>;
  /** Plan surface passed to `apply(source)` inside `Policy.define(...)`. */
  export type Source<T, E, A, M> = OpPolicySource<T, E, A, M>;
  /** Identity policy HKT; built-in policies extend this or `TimeoutPolicyType`. */
  export type Type = OpPolicyType;
  /** Union of built-in policy attachment types. */
  export type BuiltIn<T = unknown> = BuiltInPolicy<T>;
}

export { Delay };
export type {
  CancelPolicyAttachment,
  ExponentialDelayOptions,
  ReleasePolicyAttachment,
  RetryPolicy,
  RetryPolicyAttachment,
  TimeoutPolicyAttachment,
  TimeoutPolicyType,
};
