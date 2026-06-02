import * as fc from "fast-check";
import { assert, describe, expect, test } from "vitest";
import { Op } from "../../src/index.js";
import { UnhandledException } from "../../src/errors.js";
import { Delay, Policy, type ExponentialDelayOptions } from "../../src/policy/index.js";

const invalidExponentialDelayOptionsArb: fc.Arbitrary<ExponentialDelayOptions> = fc.oneof(
  fc.record({ baseMs: fc.constant(0), maxMs: fc.constant(1000), jitter: fc.constant(0.5) }),
  fc.record({ baseMs: fc.constant(100), maxMs: fc.constant(0), jitter: fc.constant(0.5) }),
  fc.record({ baseMs: fc.constant(100), maxMs: fc.constant(1000), jitter: fc.constant(-0.5) }),
  fc.record({ baseMs: fc.constant(100), maxMs: fc.constant(1000), jitter: fc.constant(1.5) }),
  fc.record({
    baseMs: fc.constant(Number.NaN),
    maxMs: fc.constant(1000),
    jitter: fc.constant(0.5),
  }),
  fc.record({
    baseMs: fc.constant(100),
    maxMs: fc.constant(Number.NaN),
    jitter: fc.constant(0.5),
  }),
  fc.record({
    baseMs: fc.constant(100),
    maxMs: fc.constant(1000),
    jitter: fc.constant(Number.NaN),
  }),
  fc.record({ baseMs: fc.constant(-1), maxMs: fc.constant(1000), jitter: fc.constant(0.5) }),
);

describe("Delay.exponential invariants", () => {
  test("delays are finite, non-negative, and clamped to maxMs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          baseMs: fc.integer({ min: 1, max: 5_000 }),
          maxMs: fc.integer({ min: 1, max: 20_000 }),
          jitter: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        fc.integer({ min: 0, max: 19 }),
        async (options, retryIndex) => {
          const maxMs = Math.max(options.baseMs, options.maxMs);
          const getDelay = Delay.exponential({ ...options, maxMs });
          const delay = getDelay(retryIndex, undefined);

          expect(Number.isFinite(delay)).toBe(true);
          expect(delay).toBeGreaterThanOrEqual(0);
          expect(delay).toBeLessThanOrEqual(maxMs + 1);
        },
      ),
    );
  });

  test("zero jitter yields monotonic non-decreasing delays", () => {
    fc.assert(
      fc.property(
        fc.record({
          baseMs: fc.integer({ min: 1, max: 2_000 }),
          maxMs: fc.integer({ min: 1, max: 20_000 }),
        }),
        fc.integer({ min: 2, max: 15 }),
        (options, maxRetry) => {
          const maxMs = Math.max(options.baseMs, options.maxMs);
          const getDelay = Delay.exponential({ ...options, maxMs, jitter: 0 });

          let previous = getDelay(0, undefined);
          for (let retryIndex = 1; retryIndex < maxRetry; retryIndex += 1) {
            const next = getDelay(retryIndex, undefined);
            expect(next).toBeGreaterThanOrEqual(previous);
            previous = next;
          }
        },
      ),
    );
  });

  test("invalid exponential delay inputs fail at run time as UnhandledException", async () => {
    await fc.assert(
      fc.asyncProperty(invalidExponentialDelayOptionsArb, async (options) => {
        const result = await Op.fail("retryable" as const)
          .with(
            Policy.retry({
              retries: 1,
              when: () => true,
              delay: Delay.exponential(options),
            }),
          )
          .run();

        assert(result.isErr(), "expected invalid policy failure");
        expect(result.error).toBeInstanceOf(UnhandledException);
        if (result.error instanceof UnhandledException) {
          expect(result.error.cause).toBeInstanceOf(RangeError);
        }
      }),
    );
  });
});

describe("retry policy invariants", () => {
  test("run attempts never exceed one plus policy retries", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 7 }), async (policyRetries) => {
        let runAttempts = 0;
        const maxRuns = policyRetries + 1;

        const program = Op(function* () {
          runAttempts += 1;
          return yield* Op.fail("always fails" as const);
        }).with(
          Policy.retry({
            retries: policyRetries,
            when: () => true,
            delay: 0,
          }),
        );

        const result = await program.run();
        assert(result.isErr(), "expected terminal failure");
        expect(runAttempts).toBeLessThanOrEqual(maxRuns);
        expect(runAttempts).toBe(maxRuns);
      }),
    );
  });

  test("when false yields exactly one attempt", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (policyRetries) => {
        let runAttempts = 0;

        const program = Op(function* () {
          runAttempts += 1;
          return yield* Op.fail("no retry" as const);
        }).with(
          Policy.retry({
            retries: policyRetries,
            when: () => false,
            delay: 0,
          }),
        );

        const result = await program.run();
        assert(result.isErr(), "expected failure");
        expect(runAttempts).toBe(1);
      }),
    );
  });

  test("always-fail with always-retry yields exactly one plus policy retries", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 7 }), async (policyRetries) => {
        let runAttempts = 0;
        const maxRuns = policyRetries + 1;

        const program = Op(function* () {
          runAttempts += 1;
          return yield* Op.fail("retryable" as const);
        }).with(
          Policy.retry({
            retries: policyRetries,
            when: () => true,
            delay: 0,
          }),
        );

        const result = await program.run();
        assert(result.isErr(), "expected terminal failure");
        expect(runAttempts).toBe(maxRuns);
      }),
    );
  });

  test("success on attempt k yields exactly k attempts", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 7 }),
        async (successAttempt, policyRetries) => {
          fc.pre(successAttempt <= policyRetries + 1);

          let runAttempts = 0;

          const program = Op(function* () {
            runAttempts += 1;
            if (runAttempts < successAttempt) {
              return yield* Op.fail("transient" as const);
            }
            return yield* Op.of(runAttempts);
          }).with(
            Policy.retry({
              retries: policyRetries,
              when: () => true,
              delay: 0,
            }),
          );

          const result = await program.run();
          assert(result.isOk(), "expected success on configured attempt");
          expect(result.value).toBe(successAttempt);
          expect(runAttempts).toBe(successAttempt);
        },
      ),
    );
  });
});
