import type { RetryPolicy } from "./retry-policy.js";
import type { ReleaseFn } from "./types.js";

export const OP_POLICY = Symbol("prodkit.op.policy");

export interface RetryPolicyAttachment {
  readonly [OP_POLICY]: "retry";
  readonly policy: RetryPolicy | undefined;
}

export interface TimeoutPolicyAttachment {
  readonly [OP_POLICY]: "timeout";
  readonly timeoutMs: number;
}

export interface SignalPolicyAttachment {
  readonly [OP_POLICY]: "signal";
  readonly signal: AbortSignal;
}

export interface ReleasePolicyAttachment<T> {
  readonly [OP_POLICY]: "release";
  readonly release: ReleaseFn<T>;
}

export type BuiltInPolicy<T = unknown> =
  | RetryPolicyAttachment
  | TimeoutPolicyAttachment
  | SignalPolicyAttachment
  | ReleasePolicyAttachment<T>;
