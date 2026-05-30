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

export interface CancelPolicyAttachment {
  readonly [OP_POLICY]: "cancel";
  readonly abortSignal: AbortSignal;
}

export interface ReleasePolicyAttachment<T> {
  readonly [OP_POLICY]: "release";
  readonly release: ReleaseFn<T>;
}

export type BuiltInPolicy<T = unknown> =
  | RetryPolicyAttachment
  | TimeoutPolicyAttachment
  | CancelPolicyAttachment
  | ReleasePolicyAttachment<T>;
