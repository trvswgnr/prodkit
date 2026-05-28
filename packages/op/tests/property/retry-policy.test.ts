import * as fc from "fast-check";
import { assert, describe, expect, test } from "vitest";
import { Op, exponentialBackoff } from "../../src/index.js";
import type { RequireOne } from "../../src/core/types.js";
import type { BackoffOptions } from "../../src/policies.js";

const invalidBackoffOptionsArb: fc.Arbitrary<RequireOne<BackoffOptions>> = fc.oneof(
  fc.record({ base: fc.constant(0), max: fc.constant(1000), jitter: fc.constant(0.5) }),
  fc.record({ base: fc.constant(100), max: fc.constant(0), jitter: fc.constant(0.5) }),
  fc.record({ base: fc.constant(100), max: fc.constant(1000), jitter: fc.constant(-0.5) }),
  fc.record({ base: fc.constant(100), max: fc.constant(1000), jitter: fc.constant(1.5) }),
  fc.record({
    base: fc.constant(Number.NaN),
    max: fc.constant(1000),
    jitter: fc.constant(0.5),
  }),
  fc.record({
    base: fc.constant(100),
    max: fc.constant(Number.NaN),
    jitter: fc.constant(0.5),
  }),
  fc.record({
    base: fc.constant(100),
    max: fc.constant(1000),
    jitter: fc.constant(Number.NaN),
  }),
  fc.record({ base: fc.constant(-1), max: fc.constant(1000), jitter: fc.constant(0.5) }),
);

describe("exponentialBackoff invariants (property-based)", () => {
  test("delays are finite, non-negative, and clamped to max", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          base: fc.integer({ min: 1, max: 5_000 }),
          max: fc.integer({ min: 1, max: 20_000 }),
          jitter: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        fc.integer({ min: 1, max: 20 }),
        async (options, attempt) => {
          const max = Math.max(options.base, options.max);
          const getDelay = exponentialBackoff({ ...options, max });
          const delay = getDelay(attempt);

          expect(Number.isFinite(delay)).toBe(true);
          expect(delay).toBeGreaterThanOrEqual(0);
          expect(delay).toBeLessThanOrEqual(max + 1);
        },
      ),
    );
  });

  test("zero jitter yields monotonic non-decreasing delays", () => {
    fc.assert(
      fc.property(
        fc.record({
          base: fc.integer({ min: 1, max: 2_000 }),
          max: fc.integer({ min: 1, max: 20_000 }),
        }),
        fc.integer({ min: 2, max: 15 }),
        (options, maxAttempt) => {
          const max = Math.max(options.base, options.max);
          const getDelay = exponentialBackoff({ ...options, max, jitter: 0 });

          let previous = getDelay(1);
          for (let attempt = 2; attempt <= maxAttempt; attempt += 1) {
            const next = getDelay(attempt);
            expect(next).toBeGreaterThanOrEqual(previous);
            previous = next;
          }
        },
      ),
    );
  });

  test("invalid option inputs normalize to safe defaults", () => {
    fc.assert(
      fc.property(invalidBackoffOptionsArb, fc.integer({ min: 1, max: 10 }), (options, attempt) => {
        expect(() => exponentialBackoff(options)).not.toThrow();

        const getDelay = exponentialBackoff(options);
        const delay = getDelay(attempt);

        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe("retry policy invariants (property-based)", () => {
  test("attempts never exceed maxAttempts", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (maxAttempts) => {
        let attempts = 0;

        const program = Op(function* () {
          attempts += 1;
          return yield* Op.fail("always fails" as const);
        }).withRetry({
          maxAttempts,
          shouldRetry: () => true,
          getDelay: () => 0,
        });

        const result = await program.run();
        assert(result.isErr(), "expected terminal failure");
        expect(attempts).toBeLessThanOrEqual(maxAttempts);
        expect(attempts).toBe(maxAttempts);
      }),
    );
  });

  test("shouldRetry false yields exactly one attempt", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 10 }), async (maxAttempts) => {
        let attempts = 0;

        const program = Op(function* () {
          attempts += 1;
          return yield* Op.fail("no retry" as const);
        }).withRetry({
          maxAttempts,
          shouldRetry: () => false,
          getDelay: () => 0,
        });

        const result = await program.run();
        assert(result.isErr(), "expected failure");
        expect(attempts).toBe(1);
      }),
    );
  });

  test("always-fail with always-retry yields exactly maxAttempts", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (maxAttempts) => {
        let attempts = 0;

        const program = Op(function* () {
          attempts += 1;
          return yield* Op.fail("retryable" as const);
        }).withRetry({
          maxAttempts,
          shouldRetry: () => true,
          getDelay: () => 0,
        });

        const result = await program.run();
        assert(result.isErr(), "expected terminal failure");
        expect(attempts).toBe(maxAttempts);
      }),
    );
  });

  test("success on attempt k yields exactly k attempts", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 8 }),
        async (successAttempt, maxAttempts) => {
          fc.pre(successAttempt <= maxAttempts);

          let attempts = 0;

          const program = Op(function* () {
            attempts += 1;
            if (attempts < successAttempt) {
              return yield* Op.fail("transient" as const);
            }
            return yield* Op.of(attempts);
          }).withRetry({
            maxAttempts,
            shouldRetry: () => true,
            getDelay: () => 0,
          });

          const result = await program.run();
          assert(result.isOk(), "expected success on configured attempt");
          expect(result.value).toBe(successAttempt);
          expect(attempts).toBe(successAttempt);
        },
      ),
    );
  });
});
