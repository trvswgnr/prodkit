import { define } from "./types.js";
import { cancelRewriter, releasePlan, retryRewriter, timeoutRewriter } from "./plan.js";
import { Delay, normalizeRetryPolicy } from "./retry-policy.js";
import type {
  ApplyOpPolicy,
  BuiltInPolicy,
  CancelPolicyAttachment,
  CancelPolicyType,
  OpPolicy,
  OpPolicyArg,
  OpPolicyArgs,
  OpPolicyInput,
  OpPolicyResult,
  OpPolicySource,
  OpPolicyType,
  ReleasePolicyAttachment,
  ReleasePolicyType,
  RetryPolicyAttachment,
  RetryPolicyType,
  TimeoutPolicyAttachment,
  TimeoutPolicyType,
} from "./types.js";
import type { ExponentialDelayOptions, RetryDelay, RetryPolicy } from "./retry-policy.js";
import type { ReleaseFn } from "../core/types.js";

/** Creates a retry policy attachment for `op.with(...)`. */
export function retry(policy?: RetryPolicy): RetryPolicyAttachment {
  const rewriter = retryRewriter(normalizeRetryPolicy(policy));
  return define<unknown, RetryPolicyType, { readonly policy: RetryPolicy | undefined }>({
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
  return define<unknown, CancelPolicyType, { readonly abortSignal: AbortSignal }>({
    abortSignal,
    apply: (source) => source.rewrite(rewriter),
  });
}

/** Creates a release policy attachment for `op.with(...)`. */
export function release<T>(releaseFn: ReleaseFn<T>): ReleasePolicyAttachment<T> {
  return define<OpPolicyInput<T>, ReleasePolicyType, { readonly release: ReleaseFn<T> }>({
    release: releaseFn,
    apply: (source) => source.wrap((plan) => releasePlan(plan, releaseFn as ReleaseFn<unknown>)),
  });
}

export { Delay, define };
export type {
  ApplyOpPolicy,
  BuiltInPolicy,
  CancelPolicyAttachment,
  CancelPolicyType,
  OpPolicy,
  OpPolicyArg,
  OpPolicyArgs,
  OpPolicyInput,
  OpPolicyResult,
  OpPolicySource,
  OpPolicyType,
  ExponentialDelayOptions,
  ReleasePolicyAttachment,
  ReleasePolicyType,
  RetryDelay,
  RetryPolicy,
  RetryPolicyAttachment,
  RetryPolicyType,
  TimeoutPolicyAttachment,
  TimeoutPolicyType,
};
