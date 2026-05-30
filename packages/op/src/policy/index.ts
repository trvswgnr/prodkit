import { OP_POLICY } from "../core/policy.js";
import { Delay } from "../core/retry-policy.js";
import type {
  BuiltInPolicy,
  CancelPolicyAttachment,
  ReleasePolicyAttachment,
  RetryPolicyAttachment,
  TimeoutPolicyAttachment,
} from "../core/policy.js";
import type { ExponentialDelayOptions, RetryDelay, RetryPolicy } from "../core/retry-policy.js";
import type { ReleaseFn } from "../core/types.js";

/** Creates a retry policy attachment for `op.with(...)`. */
export function retry(policy?: RetryPolicy): RetryPolicyAttachment {
  return { [OP_POLICY]: "retry", policy };
}

/** Creates a timeout policy attachment for `op.with(...)`. */
export function timeout(timeoutMs: number): TimeoutPolicyAttachment {
  return { [OP_POLICY]: "timeout", timeoutMs };
}

/** Creates a cancellation policy attachment for `op.with(...)`. */
export function cancel(abortSignal: AbortSignal): CancelPolicyAttachment {
  return { [OP_POLICY]: "cancel", abortSignal };
}

/** Creates a release policy attachment for `op.with(...)`. */
export function release<T>(releaseFn: ReleaseFn<T>): ReleasePolicyAttachment<T> {
  return { [OP_POLICY]: "release", release: releaseFn };
}

export { Delay };
export type {
  BuiltInPolicy,
  CancelPolicyAttachment,
  ExponentialDelayOptions,
  ReleasePolicyAttachment,
  RetryDelay,
  RetryPolicy,
  RetryPolicyAttachment,
  TimeoutPolicyAttachment,
};
