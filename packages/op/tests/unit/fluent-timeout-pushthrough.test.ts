import { assert, describe, expect, test, vi } from "vitest";
import { Op, TimeoutError, type ExitContext } from "../../src/index.js";
import { UnhandledException } from "../../src/errors.js";

const TIMEOUT_MS = 10;
const GENEROUS_TIMEOUT_MS = 1000;

const hangingOp = Op.try((_signal) => new Promise<number>(() => {}));

async function runWithFakeTimeout<T, E, M>(program: Op<T, E, [], M>) {
  vi.useFakeTimers();
  try {
    const runPromise = program.run();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    return await runPromise;
  } finally {
    vi.useRealTimers();
  }
}

describe("withTimeout push-through matrix", () => {
  test.each([
    {
      combinator: "mapErr",
      run: async () => {
        const result = await runWithFakeTimeout(
          hangingOp()
            .mapErr((error) => ({ kind: "app" as const, error }))
            .withTimeout(TIMEOUT_MS),
        );
        assert(result.isErr(), "should be Err");
        expect(result.error).toBeInstanceOf(TimeoutError);
      },
    },
    {
      combinator: "tapErr",
      run: async () => {
        const observe = vi.fn(() => undefined);
        const result = await runWithFakeTimeout(
          hangingOp().tapErr(observe).withTimeout(TIMEOUT_MS),
        );
        assert(result.isErr(), "should be Err");
        expect(result.error).toBeInstanceOf(TimeoutError);
        expect(observe).not.toHaveBeenCalled();
      },
    },
    {
      combinator: "recover",
      run: async () => {
        const result = await runWithFakeTimeout(
          hangingOp()
            .recover(
              (_e): _e is never => true,
              () => Op.of(69),
            )
            .withTimeout(TIMEOUT_MS),
        );
        assert(result.isErr(), "should be Err");
        expect(result.error).toBeInstanceOf(TimeoutError);
      },
    },
  ])("$combinator after combinator: push-through preserves TimeoutError", async ({ run }) => {
    await run();
  });

  test.each([
    {
      combinator: "mapErr",
      run: async () => {
        const result = await Op.fail("bad" as const)
          .mapErr((error) => ({ kind: "app" as const, error }))
          .withTimeout(GENEROUS_TIMEOUT_MS)
          .run();
        assert(result.isErr(), "should be Err");
        expect(result.error).toEqual({ kind: "app", error: "bad" });
      },
    },
    {
      combinator: "tapErr",
      run: async () => {
        const seen: string[] = [];
        const result = await Op.fail("bad-input" as const)
          .tapErr((error) => {
            seen.push(error);
          })
          .withTimeout(GENEROUS_TIMEOUT_MS)
          .run();
        assert(result.isErr(), "should be Err");
        expect(result.error).toBe("bad-input");
        expect(seen).toEqual(["bad-input"]);
      },
    },
    {
      combinator: "recover",
      run: async () => {
        const result = await Op.fail("retryable" as const)
          .recover(
            (error): error is "retryable" => error === "retryable",
            () => Op.of(69),
          )
          .withTimeout(GENEROUS_TIMEOUT_MS)
          .run();
        assert(result.isOk(), "should be Ok");
        expect(result.value).toBe(69);
      },
    },
  ])(
    "$combinator after combinator: push-through still handles typed errors when work finishes in time",
    async ({ run }) => {
      await run();
    },
  );

  test.each([
    {
      placement: "after combinator",
      build: (captureExit: (ctx: ExitContext<number, never>) => void) =>
        hangingOp().on("exit", captureExit).withTimeout(TIMEOUT_MS),
    },
    {
      placement: "before combinator",
      build: (captureExit: (ctx: ExitContext<number, UnhandledException | TimeoutError>) => void) =>
        hangingOp().withTimeout(TIMEOUT_MS).on("exit", captureExit),
    },
  ])('on("exit") $placement: ExitContext.result preserves TimeoutError', async ({ build }) => {
    let exitCtx!: ExitContext<number, UnhandledException | TimeoutError>;
    const result = await runWithFakeTimeout(
      build((ctx) => {
        exitCtx = ctx;
      }),
    );

    assert(result.isErr(), "should be Err");
    expect(result.error).toBeInstanceOf(TimeoutError);
    expect(exitCtx).toBeDefined();
    expect(exitCtx.result).toBe(result);
    assert(exitCtx.result.isErr(), "exit result should be Err");
    expect(exitCtx.result.error).toBeInstanceOf(TimeoutError);
  });
});
