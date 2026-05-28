import { TimeoutError } from "./errors.js";
import type { Op } from "./index.js";
import { coerceToNullaryOp, unsafeCoerce } from "./shared.js";
import {
  DEFAULT_RETRY_POLICY,
  exponentialBackoff,
  type BackoffOptions,
  type RetryPolicy,
} from "./core/retry-policy.js";
import { getIterablePlan, getPlan } from "./core/plan/base.js";
import { makePlanOp } from "./core/plan/shell.js";

export { DEFAULT_RETRY_POLICY, exponentialBackoff, type BackoffOptions, type RetryPolicy };

function asIterableOp<T, E, A extends readonly unknown[], M>(op: Op<T, E, A, M>): Op<T, E, [], M> {
  // SAFETY: getIterablePlan checks the runtime iterable brand before using this as nullary.
  return unsafeCoerce(op);
}

export function withRetryOp<T, E, A extends readonly unknown[], M>(
  op: Op<T, E, A, M>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Op<T, E, A, M> {
  const iterable = getIterablePlan(asIterableOp(op));
  const wrapped = makePlanOp<T, E, A, M>(
    (...args) => getPlan(op, args).withRetry(policy),
    iterable === undefined ? undefined : () => iterable.withRetry(policy),
    coerceToNullaryOp(op) !== undefined,
  );

  // SAFETY: makePlanOp installs the Op brand used by the public Op type.
  return unsafeCoerce(wrapped);
}

export function withTimeoutOp<T, E, A extends readonly unknown[], M>(
  op: Op<T, E, A, M>,
  timeoutMs: number,
): Op<T, E | TimeoutError, A, M> {
  const iterable = getIterablePlan(asIterableOp(op));
  const wrapped = makePlanOp<T, E | TimeoutError, A, M>(
    (...args) => getPlan(op, args).withTimeout(timeoutMs),
    iterable === undefined ? undefined : () => iterable.withTimeout(timeoutMs),
    coerceToNullaryOp(op) !== undefined,
  );

  // SAFETY: makePlanOp installs the Op brand used by the public Op type.
  return unsafeCoerce(wrapped);
}

export function withSignalOp<T, E, A extends readonly unknown[], M>(
  op: Op<T, E, A, M>,
  signal: AbortSignal,
): Op<T, E, A, M> {
  const iterable = getIterablePlan(asIterableOp(op));
  const wrapped = makePlanOp<T, E, A, M>(
    (...args) => getPlan(op, args).withSignal(signal),
    iterable === undefined ? undefined : () => iterable.withSignal(signal),
    coerceToNullaryOp(op) !== undefined,
  );

  // SAFETY: makePlanOp installs the Op brand used by the public Op type.
  return unsafeCoerce(wrapped);
}
