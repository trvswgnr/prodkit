/** Delay in milliseconds, or a function that returns one for a retry attempt. */
export type RetryDelay = number | ((attempt: number, cause: unknown) => number);

/** Retry policy for `op.with(Policy.retry(policy))`. */
export interface RetryPolicy {
  /** Total tries, including the first attempt. */
  attempts?: number;
  /** Whether to retry after a failure. Receives the root cause. */
  when?: (cause: unknown) => boolean;
  /** Delay in milliseconds before the next attempt. */
  delay?: RetryDelay;
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
  readonly getDelay: (attempt: number, cause: unknown) => number;
}

const DELAY_VALIDATE: unique symbol = Symbol("prodkit.op.delay.validate");
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_EXPONENTIAL_DELAY_OPTIONS = Object.freeze({
  baseMs: 1_000,
  maxMs: 30_000,
  jitter: 1,
}) satisfies Required<ExponentialDelayOptions>;

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

function assertNonNegativeNumber(value: number, name: string): void {
  assertFiniteNumber(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be greater than or equal to 0`);
  }
}

function assertPositiveNumber(value: number, name: string): void {
  assertFiniteNumber(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than 0`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  assertPositiveNumber(value, name);
  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be an integer`);
  }
}

function assertJitter(value: number): void {
  assertFiniteNumber(value, "jitter");
  if (value < 0 || value > 1) {
    throw new RangeError("jitter must be between 0 and 1");
  }
}

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

type ValidatedDelay = ((attempt: number, cause: unknown) => number) & {
  readonly [DELAY_VALIDATE]: () => void;
};

function withDelayValidation(
  getDelay: (attempt: number, cause: unknown) => number,
  validate: () => void,
): ValidatedDelay {
  return Object.assign(getDelay, { [DELAY_VALIDATE]: validate });
}

function isValidatedDelay(
  delay: (attempt: number, cause: unknown) => number,
): delay is ValidatedDelay {
  return DELAY_VALIDATE in delay;
}

function validateDelay(delay: RetryDelay): void {
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

  return withDelayValidation((attempt) => {
    validate();

    const exp = Math.min(
      normalized.baseMs * Math.pow(2, Math.max(0, attempt - 1)),
      normalized.maxMs,
    );

    if (normalized.jitter === 0) return exp;

    const spread = exp * normalized.jitter;
    return exp - spread + Math.random() * spread;
  }, validate);
};

/** Built-in retry delay helpers for `RetryPolicy.delay`. */
export const Delay = Object.freeze({
  /** Constant delay in milliseconds before each retry attempt. */
  fixed,
  /** Exponential backoff with optional jitter, capped at `maxMs`. */
  exponential,
  /** Zero delay between attempts. */
  immediate: fixed(0),
  /** Default exponential backoff used by `Policy.retry()` with no policy argument. */
  defaultRetry: exponential(DEFAULT_EXPONENTIAL_DELAY_OPTIONS),
});

const DEFAULT_RETRY_POLICY = Object.freeze({
  attempts: DEFAULT_ATTEMPTS,
  when: () => true,
  delay: Delay.defaultRetry,
}) satisfies Required<RetryPolicy>;

function validateRetryPolicy(policy: Required<RetryPolicy>): void {
  assertPositiveInteger(policy.attempts, "attempts");

  if (typeof policy.when !== "function") {
    throw new TypeError("when must be a function");
  }

  if (typeof policy.delay !== "number" && typeof policy.delay !== "function") {
    throw new TypeError("delay must be a number or function");
  }

  validateDelay(policy.delay);
}

function normalizeDelay(delay: RetryDelay): (attempt: number, cause: unknown) => number {
  if (typeof delay === "number") return () => delay;
  return delay;
}

export function normalizeRetryPolicy(policy?: RetryPolicy): NormalizedRetryPolicy {
  const normalized = {
    attempts: policy?.attempts ?? DEFAULT_RETRY_POLICY.attempts,
    when: policy?.when ?? DEFAULT_RETRY_POLICY.when,
    delay: policy?.delay ?? DEFAULT_RETRY_POLICY.delay,
  } satisfies Required<RetryPolicy>;

  return {
    validate: () => validateRetryPolicy(normalized),
    maxAttempts: normalized.attempts,
    shouldRetry: normalized.when,
    getDelay: (attempt, cause) => {
      const delay = normalizeDelay(normalized.delay)(attempt, cause);
      assertNonNegativeNumber(delay, "delay");
      return delay;
    },
  };
}
