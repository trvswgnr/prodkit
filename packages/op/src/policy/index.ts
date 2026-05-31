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
  return define<OpPolicyInput<T>, OpPolicyType, { readonly release: ReleaseFn<T> }>({
    release: releaseFn,
    apply: (source) => source.wrap((plan) => releasePlan(plan, releaseFn as ReleaseFn<unknown>)),
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

export { Delay };
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
