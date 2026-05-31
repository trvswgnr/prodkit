import { HKT_ARGS, HKT_RESULT } from "../hkt.js";
import { definePolicy } from "./types.js";
import { cancelRewriter, releasePlan, retryRewriter, timeoutRewriter } from "./plan.js";
import { Delay, normalizeRetryPolicy } from "./retry-policy.js";
import type { Apply, HKT, HKTArg } from "../hkt.js";
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
  return definePolicy<unknown, RetryPolicyType, { readonly policy: RetryPolicy | undefined }>({
    policy,
    apply: (source) => {
      const retryPolicy = normalizeRetryPolicy(policy);
      return source.rewrite(retryRewriter(retryPolicy));
    },
  });
}

/** Creates a timeout policy attachment for `op.with(...)`. */
export function timeout(timeoutMs: number): TimeoutPolicyAttachment {
  return definePolicy<unknown, TimeoutPolicyType, { readonly timeoutMs: number }>({
    timeoutMs,
    apply: (source) => source.rewrite(timeoutRewriter(timeoutMs)),
  });
}

/** Creates a cancellation policy attachment for `op.with(...)`. */
export function cancel(abortSignal: AbortSignal): CancelPolicyAttachment {
  return definePolicy<unknown, CancelPolicyType, { readonly abortSignal: AbortSignal }>({
    abortSignal,
    apply: (source) => source.rewrite(cancelRewriter(abortSignal)),
  });
}

/** Creates a release policy attachment for `op.with(...)`. */
export function release<T>(releaseFn: ReleaseFn<T>): ReleasePolicyAttachment<T> {
  return definePolicy<OpPolicyInput<T>, ReleasePolicyType, { readonly release: ReleaseFn<T> }>({
    release: releaseFn,
    apply: (source) => source.wrap((plan) => releasePlan(plan, releaseFn as ReleaseFn<unknown>)),
  });
}

export { Delay, HKT_ARGS, HKT_RESULT, definePolicy, definePolicy as define };
export type {
  Apply,
  ApplyOpPolicy,
  BuiltInPolicy,
  CancelPolicyAttachment,
  CancelPolicyType,
  HKT,
  HKTArg,
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
