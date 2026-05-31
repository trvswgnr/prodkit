import {
  assertJitter,
  assertNonNegativeInteger,
  assertNonNegativeNumber,
  assertPositiveNumber,
  assertFiniteNumber,
} from "./validate.js";

/**
 * Retry delay configuration for `RetryPolicy.delay`: fixed milliseconds or
 * `(retry, cause) => ms` before an upcoming retry (`retry` is 0-based). For built-in delay
 * functions, use the `Delay` helper namespace (`Delay.fixed`, `Delay.exponential`, and so on).
 */
export type Delay = number | ((retry: number, cause: unknown) => number);

/** Configuration for `Policy.retry(policy)`. `retries` is the post-failure budget; `delay(retry, cause)` uses a 0-based retry index. */
export interface RetryPolicy {
  /** How many times to retry after the first failure. */
  retries?: number;
  /** Whether to retry after a failure. Receives the root cause. */
  when?: (cause: unknown) => boolean;
  /** Delay before the next retry: fixed milliseconds or `(retry, cause) => ms`. */
  delay?: Delay;
}

/** Options for `Delay.exponential(options)`. */
export interface ExponentialDelayOptions {
  /** Initial delay in milliseconds. */
  baseMs?: number;
  /** Maximum delay in milliseconds. */
  maxMs?: number;
  /** Fraction of the computed delay to randomize, from `0` to `1`. */
  jitter?: number;
}

export interface NormalizedRetryPolicy {
  readonly validate: () => void;
  readonly maxAttempts: number;
  readonly shouldRetry: (cause: unknown) => boolean;
  readonly getDelay: (retry: number, cause: unknown) => number;
}

const DELAY_VALIDATE: unique symbol = Symbol("prodkit.op.delay.validate");
const DEFAULT_RETRIES = 2;
const DEFAULT_EXPONENTIAL_DELAY_OPTIONS = Object.freeze({
  baseMs: 1_000,
  maxMs: 30_000,
  jitter: 1,
}) satisfies Required<ExponentialDelayOptions>;

function normalizeExponentialDelayOptions(
  options?: ExponentialDelayOptions,
): Required<ExponentialDelayOptions> {
  return {
    baseMs: options?.baseMs ?? DEFAULT_EXPONENTIAL_DELAY_OPTIONS.baseMs,
    maxMs: options?.maxMs ?? DEFAULT_EXPONENTIAL_DELAY_OPTIONS.maxMs,
    jitter: options?.jitter ?? DEFAULT_EXPONENTIAL_DELAY_OPTIONS.jitter,
  };
}

function validateExponentialDelayOptions(options: Required<ExponentialDelayOptions>): void {
  assertPositiveNumber(options.baseMs, "baseMs");
  assertFiniteNumber(options.maxMs, "maxMs");
  if (options.maxMs < options.baseMs) {
    throw new RangeError("maxMs must be greater than or equal to baseMs");
  }
  assertJitter(options.jitter);
}

type ValidatedDelay = ((retry: number, cause: unknown) => number) & {
  readonly [DELAY_VALIDATE]: () => void;
};

function withDelayValidation(
  getDelay: (retry: number, cause: unknown) => number,
  validate: () => void,
): ValidatedDelay {
  return Object.assign(getDelay, { [DELAY_VALIDATE]: validate });
}

function isValidatedDelay(
  delay: (retry: number, cause: unknown) => number,
): delay is ValidatedDelay {
  return DELAY_VALIDATE in delay;
}

function validateDelay(delay: Delay): void {
  if (typeof delay === "number") {
    assertNonNegativeNumber(delay, "delay");
    return;
  }

  if (isValidatedDelay(delay)) {
    delay[DELAY_VALIDATE]();
  }
}

const fixed = (ms: number) =>
  withDelayValidation(
    () => ms,
    () => assertNonNegativeNumber(ms, "delay"),
  );

const exponential = (options?: ExponentialDelayOptions) => {
  const normalized = normalizeExponentialDelayOptions(options);
  const validate = () => validateExponentialDelayOptions(normalized);

  return withDelayValidation((retry) => {
    const exp = Math.min(normalized.baseMs * Math.pow(2, retry), normalized.maxMs);

    if (normalized.jitter === 0) return exp;

    const spread = exp * normalized.jitter;
    return exp - spread + Math.random() * spread;
  }, validate);
};

/** Built-in retry delay helpers for `RetryPolicy.delay`. See also the `Delay` type alias. */
export const Delay = Object.freeze({
  /** Constant delay in milliseconds before each retry attempt. */
  fixed,
  /** Exponential backoff: `baseMs * 2 ** retry`, capped at `maxMs`. */
  exponential,
  /** Zero delay between retries. */
  immediate: fixed(0),
  /** Default exponential backoff used by `Policy.retry()` with no policy argument. */
  defaultRetry: exponential(DEFAULT_EXPONENTIAL_DELAY_OPTIONS),
});

const DEFAULT_RETRY_POLICY = Object.freeze({
  retries: DEFAULT_RETRIES,
  when: () => true,
  delay: Delay.defaultRetry,
}) satisfies Required<RetryPolicy>;

function validateRetryPolicy(policy: Required<RetryPolicy>): void {
  assertNonNegativeInteger(policy.retries, "retries");

  if (typeof policy.when !== "function") {
    throw new TypeError("when must be a function");
  }

  if (typeof policy.delay !== "number" && typeof policy.delay !== "function") {
    throw new TypeError("delay must be a number or function");
  }

  validateDelay(policy.delay);
}

function normalizeDelay(delay: Delay): (retry: number, cause: unknown) => number {
  if (typeof delay === "number") return () => delay;
  return delay;
}

export function normalizeRetryPolicy(policy?: RetryPolicy): NormalizedRetryPolicy {
  if (policy === null) {
    return {
      validate: () => {
        throw new TypeError("retry policy must not be null");
      },
      maxAttempts: 1,
      shouldRetry: () => false,
      getDelay: () => 0,
    };
  }

  const normalized = {
    retries: policy?.retries ?? DEFAULT_RETRY_POLICY.retries,
    when: policy?.when ?? DEFAULT_RETRY_POLICY.when,
    delay: policy?.delay ?? DEFAULT_RETRY_POLICY.delay,
  } satisfies Required<RetryPolicy>;

  return {
    validate: () => validateRetryPolicy(normalized),
    maxAttempts: normalized.retries + 1,
    shouldRetry: normalized.when,
    getDelay: (retry, cause) => {
      const delay = normalizeDelay(normalized.delay)(retry, cause);
      assertNonNegativeNumber(delay, "delay");
      return delay;
    },
  };
}
