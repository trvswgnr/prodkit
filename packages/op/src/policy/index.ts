import { define } from "./types.js";
import { cancelRewriter, releasePlan, retryRewriter, timeoutRewriter } from "./plan.js";
import { Delay, normalizeRetryPolicy } from "./retry-policy.js";
import type {
  ApplyOpPolicy,
  BuiltInPolicy,
  CancelPolicyAttachment,
  OpPolicy,
  OpPolicyInput,
  OpPolicyResult,
  OpPolicySource,
  OpPolicyType,
  ReleasePolicyAttachment,
  RetryPolicyAttachment,
  TimeoutPolicyAttachment,
  TimeoutPolicyType,
} from "./types.js";
import type { ExponentialDelayOptions, RetryDelay, RetryPolicy } from "./retry-policy.js";
import type { ReleaseFn } from "../core/types.js";

/** Creates a retry policy attachment for `op.with(...)`. Uses default `retries: 2` when omitted. */
export function retry(policy?: RetryPolicy): RetryPolicyAttachment {
  const rewriter = retryRewriter(normalizeRetryPolicy(policy));
  return define<unknown, OpPolicyType, { readonly policy: RetryPolicy | undefined }>({
    policy,
    apply: (source) => source.rewrite(rewriter),
  });
}

/** Creates a timeout policy attachment for `op.with(...)`. */
export function timeout(timeoutMs: number): TimeoutPolicyAttachment {
  const rewriter = timeoutRewriter(timeoutMs);
  return define<unknown, TimeoutPolicyType, { readonly timeoutMs: number }>({
    timeoutMs,
    apply: (source) => source.rewrite(rewriter),
  });
}

/** Creates a cancellation policy attachment for `op.with(...)`. */
export function cancel(abortSignal: AbortSignal): CancelPolicyAttachment {
  const rewriter = cancelRewriter(abortSignal);
  return define<unknown, OpPolicyType, { readonly abortSignal: AbortSignal }>({
    abortSignal,
    apply: (source) => source.rewrite(rewriter),
  });
}

/** Creates a release policy attachment for `op.with(...)`. */
export function release<T>(releaseFn: ReleaseFn<T>): ReleasePolicyAttachment<T> {
  return define<OpPolicyInput<T>, OpPolicyType, { readonly release: ReleaseFn<T> }>({
    release: releaseFn,
    apply: (source) => source.wrap((plan) => releasePlan(plan, releaseFn as ReleaseFn<unknown>)),
  });
}

export { Delay, define };
export type {
  ApplyOpPolicy,
  BuiltInPolicy,
  CancelPolicyAttachment,
  OpPolicy,
  OpPolicyInput,
  OpPolicyResult,
  OpPolicySource,
  OpPolicyType,
  ExponentialDelayOptions,
  ReleasePolicyAttachment,
  RetryDelay,
  RetryPolicy,
  RetryPolicyAttachment,
  TimeoutPolicyAttachment,
  TimeoutPolicyType,
};
