import { unsafeCoerce } from "@prodkit/shared/runtime";
import { describe, expect, test, assert, vi } from "vitest";
import { fail, fromGenFn, succeed, _try } from "../../src/builders.js";
import { UnhandledException } from "../../src/errors.js";
import { Policy } from "../../src/policy/index.js";
import type { RetryPolicy } from "../../src/policy/index.js";

describe("Policy.retry", () => {
  class FetchError extends Error {
    readonly _tag = "FetchError";
  }

  const createFetcher = (maxRetries = 1) => {
    let attempt = 0;
    return async (url: string) => {
      if (attempt < maxRetries) {
        attempt++;
        throw new FetchError("couldn't fetch");
      }
      return { url };
    };
  };

  const retryFetchError: RetryPolicy = {
    retries: 2,
    when: (cause) => cause instanceof FetchError,
    delay: () => 0,
  };

  const createFetchProgram = (
    fetcher: (url: string) => Promise<{ url: string }>,
    policy?: RetryPolicy,
  ) =>
    fromGenFn(function* (id: string) {
      return yield* _try(() => fetcher(`https://example.com/${id}`));
    }).with(Policy.retry(policy));

  test("retries on failure with default options", async () => {
    const fetcher = vi.fn(createFetcher());
    const program = createFetchProgram(fetcher);

    const result = await program.run("123");
    assert(result.isOk(), "result.ok should be true");
    expect(result.value).toEqual({ url: `https://example.com/123` });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("retries until success with custom retry predicate and delay", async () => {
    const fetcher = vi.fn(createFetcher());
    const policy: RetryPolicy = {
      retries: 2,
      when: (cause) => cause instanceof FetchError,
      delay: (retry) => (retry + 1) * 100,
    };
    const program = createFetchProgram(fetcher, policy);

    const result = await program.run("123");
    assert(result.isOk(), "result should be Ok");
    expect(result.value).toEqual({ url: `https://example.com/123` });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("stops after retries and returns the last error", async () => {
    const fetcher = vi.fn(async (_url: string) => {
      throw new FetchError("always fails");
    });
    const program = createFetchProgram(fetcher, retryFetchError);

    const result = await program.run("123");
    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test("does not retry when when returns false", async () => {
    const fetcher = vi.fn(async (_url: string) => {
      throw new FetchError("retry denied");
    });

    const policy: RetryPolicy = {
      retries: 4,
      when: () => false,
      delay: () => 0,
    };

    const program = createFetchProgram(fetcher, policy);

    const result = await program.run("123");
    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("waits for configured delay before retrying", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(createFetcher());
      const policy: RetryPolicy = {
        retries: 1,
        when: () => true,
        delay: () => 100,
      };
      const program = createFetchProgram(fetcher, policy);

      const runPromise = program.run("123");

      await Promise.resolve();
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(99);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      const result = await runPromise;
      assert(result.isOk(), "result should be Ok");
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("delay callback receives 0-based retry index", async () => {
    const delayRetries: number[] = [];
    const fetcher = vi.fn(async (_url: string) => {
      throw new FetchError("always fails");
    });
    const program = createFetchProgram(fetcher, {
      retries: 2,
      when: () => true,
      delay: (retry) => {
        delayRetries.push(retry);
        return 0;
      },
    });

    const result = await program.run("123");
    assert(result.isErr(), "result should be Err");
    expect(delayRetries).toEqual([0, 1]);
  });

  test("invalid retries fail at run time", async () => {
    const result = await createFetchProgram(vi.fn(createFetcher()), { retries: -1 }).run("123");

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    if (result.error instanceof UnhandledException) {
      expect(result.error.cause).toBeInstanceOf(RangeError);
    }
  });

  test("non-integer retries fail at run time", async () => {
    const result = await createFetchProgram(vi.fn(createFetcher()), { retries: 1.5 }).run("123");

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    if (result.error instanceof UnhandledException) {
      expect(result.error.cause).toBeInstanceOf(TypeError);
    }
  });

  test("retries zero does not retry after failure", async () => {
    const fetcher = vi.fn(async (_url: string) => {
      throw new FetchError("always fails");
    });
    const program = createFetchProgram(fetcher, { retries: 0, when: () => true, delay: () => 0 });

    const result = await program.run("123");
    assert(result.isErr(), "result should be Err");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("invalid custom delay output fails at run time", async () => {
    const result = await createFetchProgram(vi.fn(createFetcher()), {
      retries: 1,
      delay: () => -1,
    }).run("123");

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    if (result.error instanceof UnhandledException) {
      expect(result.error.cause).toBeInstanceOf(RangeError);
    }
  });

  test("invalid when fails at run time", async () => {
    // SAFETY: intentionally invalid retry policy shape for runtime validation coverage.
    const invalidPolicy: RetryPolicy = unsafeCoerce({
      retries: 1,
      when: "not a function",
      delay: () => 0,
    });
    const result = await createFetchProgram(vi.fn(createFetcher()), invalidPolicy).run("123");

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    if (result.error instanceof UnhandledException) {
      expect(result.error.cause).toBeInstanceOf(TypeError);
    }
  });

  test("Policy.retry(null) fails at run time", async () => {
    let attempts = 0;
    const result = await _try(async () => {
      attempts += 1;
      throw new Error("fail");
    })
      // SAFETY: intentionally invalid retry policy for runtime validation coverage.
      .with(Policy.retry(unsafeCoerce<RetryPolicy>(null)))
      .run();

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    if (result.error instanceof UnhandledException) {
      expect(result.error.cause).toBeInstanceOf(TypeError);
    }
    expect(attempts).toBe(0);
  });

  test("works when wrapping _try directly", async () => {
    let attempts = 0;
    const program = _try(async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new FetchError("transient failure");
      }
      return { ok: true as const };
    }).with(
      Policy.retry({
        retries: 2,
        when: (cause) => cause instanceof FetchError,
        delay: () => 0,
      }),
    );

    const result = await program.run();
    assert(result.isOk(), "result should be Ok");
    expect(result.value).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  test("wrapping _try directly can retry UnhandledException causes", async () => {
    let attempts = 0;
    const transient = new Error("temporary outage");
    const delayCauses: unknown[] = [];
    const program = _try(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw transient;
      }
      return "done";
    }).with(
      Policy.retry({
        retries: 2,
        when: (cause) => cause === transient,
        delay: (_retry, cause) => {
          delayCauses.push(cause);
          return 0;
        },
      }),
    );

    const result = await program.run();
    assert(result.isOk(), "result should be Ok");
    expect(result.value).toBe("done");
    expect(attempts).toBe(3);
    expect(delayCauses).toEqual([transient, transient]);
  });

  test("retries a child op inside a parent op", async () => {
    let attempts = 0;
    const transient = new FetchError("intermittent");
    const child = () =>
      _try(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw transient;
        }
        return 19;
      });

    const parent = fromGenFn(function* () {
      const base = yield* succeed(50);
      const fetched = yield* child().with(
        Policy.retry({
          retries: 2,
          when: (cause) => cause instanceof FetchError,
          delay: () => 0,
        }),
      );
      return base + fetched;
    });

    const result = await parent.run();
    assert(result.isOk(), "result should be Ok");
    expect(result.value).toBe(69);
    expect(attempts).toBe(2);
  });

  test("retries Op.try(async fn) with fluent API", async () => {
    let attempts = 0;
    const transient = new Error("temporary");
    const program = fromGenFn(function* (id: string) {
      attempts += 1;
      if (attempts === 1) {
        throw transient;
      }
      return yield* _try(() => Promise.resolve({ url: `https://example.com/${id}` }));
    }).with(
      Policy.retry({
        retries: 2,
        when: (cause: unknown) => cause === transient,
        delay: () => 0,
      }),
    );

    const result = await program.run("123");
    assert(result.isOk(), "result should be Ok");
    expect(result.value).toEqual({ url: "https://example.com/123" });
    expect(attempts).toBe(2);
  });

  test("retries generator ops with fluent API", async () => {
    let attempts = 0;
    const program = fromGenFn(function* (id: string) {
      attempts += 1;
      if (attempts === 1) {
        return yield* fail(new FetchError("first attempt failed"));
      }
      return { url: `https://example.com/${id}` };
    }).with(
      Policy.retry({
        retries: 2,
        when: (cause) => cause instanceof FetchError,
        delay: () => 0,
      }),
    );

    const result = await program.run("123");
    assert(result.isOk(), "result should be Ok");
    expect(result.value).toEqual({ url: "https://example.com/123" });
    expect(attempts).toBe(2);
  });
});
