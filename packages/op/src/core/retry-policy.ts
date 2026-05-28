import type { RequireOne } from "./types.js";

/** Retry policy for `op.withRetry(policy)`. */
export interface RetryPolicy {
  /** Total tries, including the first attempt. */
  maxAttempts: number;
  /** Whether to retry after a failure (receives the root cause). */
  shouldRetry: (cause: unknown) => boolean;
  /** Delay in milliseconds before the next attempt (attempt starts at 1). */
  getDelay: (attempt: number, cause: unknown) => number;
}

/**
 * Creates a retry delay function with exponential growth and optional jitter
 */
export interface BackoffOptions {
  /** Initial delay in milliseconds. */
  base: number;
  /** Maximum delay in milliseconds. */
  max: number;
  /** Fraction of the computed delay to randomize (0 = none, 1 = full jitter). */
  jitter: number;
}

const DEFAULT_BACKOFF_OPTIONS: BackoffOptions = { base: 1_000, max: 30_000, jitter: 1 };

function normalizeBackoffOptions(opts?: RequireOne<BackoffOptions>): BackoffOptions {
  const baseCandidate = opts?.base ?? DEFAULT_BACKOFF_OPTIONS.base;
  const base =
    Number.isFinite(baseCandidate) && baseCandidate > 0
      ? baseCandidate
      : DEFAULT_BACKOFF_OPTIONS.base;

  const maxCandidate = opts?.max ?? DEFAULT_BACKOFF_OPTIONS.max;
  const max = Number.isFinite(maxCandidate) && maxCandidate >= base ? maxCandidate : base;

  const jitterCandidate = opts?.jitter ?? DEFAULT_BACKOFF_OPTIONS.jitter;
  const jitter = Number.isFinite(jitterCandidate)
    ? Math.min(1, Math.max(0, jitterCandidate))
    : DEFAULT_BACKOFF_OPTIONS.jitter;

  return { base, max, jitter };
}

/**
 * Creates a delay function for exponential backoff with optional jitter
 * @param opts Options for the backoff function
 * @returns A function that calculates the delay in milliseconds for a given attempt
 */
export function exponentialBackoff(opts?: RequireOne<BackoffOptions>): (attempt: number) => number {
  const { base, max, jitter } = normalizeBackoffOptions(opts);

  return (attempt) => {
    const exp = Math.min(base * Math.pow(2, Math.max(0, attempt - 1)), max);

    if (jitter === 0) return exp;

    const spread = exp * jitter;

    return exp - spread + Math.random() * spread;
  };
}
exponentialBackoff.DEFAULT = exponentialBackoff(DEFAULT_BACKOFF_OPTIONS);

export const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  shouldRetry: () => true,
  getDelay: exponentialBackoff.DEFAULT,
}) satisfies RetryPolicy;
