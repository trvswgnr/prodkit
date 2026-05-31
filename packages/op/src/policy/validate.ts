export function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

export function assertNonNegativeNumber(value: number, name: string): void {
  assertFiniteNumber(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be greater than or equal to 0`);
  }
}

export function assertPositiveNumber(value: number, name: string): void {
  assertFiniteNumber(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than 0`);
  }
}

export function assertPositiveInteger(value: number, name: string): void {
  assertFiniteNumber(value, name);
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than 0`);
  }
}

export function assertJitter(value: number): void {
  assertFiniteNumber(value, "jitter");
  if (value < 0 || value > 1) {
    throw new RangeError("jitter must be between 0 and 1");
  }
}

/** Validates `Policy.timeout(timeoutMs)` at run time. */
export function validateTimeoutMs(timeoutMs: number): void {
  assertNonNegativeNumber(timeoutMs, "timeoutMs");
}
