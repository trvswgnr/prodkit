import { OP_POLICY } from "../core/policy.js";
import { Delay } from "../core/retry-policy.js";
import type {
  BuiltInPolicy,
  ReleasePolicyAttachment,
  RetryPolicyAttachment,
  SignalPolicyAttachment,
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

/** Creates an abort-signal policy attachment for `op.with(...)`. */
export function signal(abortSignal: AbortSignal): SignalPolicyAttachment {
  return { [OP_POLICY]: "signal", signal: abortSignal };
}

/** Creates a release policy attachment for `op.with(...)`. */
export function release<T>(releaseFn: ReleaseFn<T>): ReleasePolicyAttachment<T> {
  return { [OP_POLICY]: "release", release: releaseFn };
}

export { Delay };
export type {
  BuiltInPolicy,
  ExponentialDelayOptions,
  ReleasePolicyAttachment,
  RetryDelay,
  RetryPolicy,
  RetryPolicyAttachment,
  SignalPolicyAttachment,
  TimeoutPolicyAttachment,
};
