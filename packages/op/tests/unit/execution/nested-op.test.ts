import { NEVER, unsafeCoerce } from "@prodkit/shared/runtime";
import { assert, describe, expect, test } from "vitest";
import type { EmptyMeta } from "../../../src/core/metadata.js";
import { ErrorGroup, UnhandledException } from "../../../src/errors.js";
import {
  CUSTOM_INSTRUCTION_META,
  type CustomInstruction,
} from "../../../src/execution/instructions.js";
import { createRunContext, drive, type RunContext } from "../../../src/execution/runtime.js";
import { Op } from "../../../src/index.js";
import { Policy } from "../../../src/policy/index.js";

class InspectContextInstruction implements CustomInstruction<void, EmptyMeta> {
  readonly [CUSTOM_INSTRUCTION_META] = NEVER;
  readonly inspect: (context: RunContext<readonly unknown[]>) => void;

  constructor(inspect: (context: RunContext<readonly unknown[]>) => void) {
    this.inspect = inspect;
  }

  resolve(context: RunContext<readonly unknown[]>): void {
    this.inspect(context);
  }

  *[Symbol.iterator](): Generator<this, void, unknown> {
    // SAFETY: the runtime resumes a CustomInstruction with the value returned by resolve().
    return unsafeCoerce(yield this);
  }
}

describe("nested Op execution", () => {
  test("deep child frames preserve the same run context", async () => {
    const depth = 20_000;
    const signal = new AbortController().signal;
    const args = ["request-7", 3] as const;
    const extensionKey = Symbol("test-extension");
    const extensionValue = { traceId: "trace-9" };
    const extensions = new Map<unknown, unknown>([[extensionKey, extensionValue]]);
    let observed!: RunContext<readonly unknown[]>;

    const nested = (remaining: number): Op<void, never, []> =>
      Op(function* () {
        if (remaining === 0) {
          return yield* new InspectContextInstruction((context) => {
            observed = context;
          });
        }
        return yield* nested(remaining - 1);
      });

    const result = await drive(nested(depth), createRunContext(signal, args, extensions));

    assert(result.isOk(), "deep nested context inspection should succeed");
    expect(observed.signal).toBe(signal);
    expect(observed.args).toBe(args);
    expect(observed.extensions).toBe(extensions);
    expect(observed.extensions.get(extensionKey)).toBe(extensionValue);
  });

  test("deep nested finalizers share LIFO ordering and cleanup precedence", async () => {
    const depth = 20_000;
    const bodyFailure = { type: "typed-failure" } as const;
    const innerCleanupFailure = new Error("inner cleanup failed");
    const outerCleanupFailure = new Error("outer cleanup failed");
    let finalized = 0;
    let previous = -1;
    let lifo = true;

    const nested = (remaining: number): Op<never, typeof bodyFailure, []> =>
      Op(function* () {
        yield* Op.defer(() => {
          lifo &&= remaining === previous + 1;
          previous = remaining;
          finalized += 1;
          if (remaining === 0) throw innerCleanupFailure;
          if (remaining === depth) throw outerCleanupFailure;
        });

        if (remaining === 0) return yield* Op.fail(bodyFailure);
        return yield* nested(remaining - 1);
      });

    const result = await nested(depth).run();

    assert(result.isErr(), "cleanup failures should override the typed body failure");
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    expect(result.error.cause).toBeInstanceOf(ErrorGroup);
    assert(result.error.cause instanceof ErrorGroup);
    expect(result.error.cause.errors).toEqual([
      bodyFailure,
      innerCleanupFailure,
      outerCleanupFailure,
    ]);
    expect(finalized).toBe(depth + 1);
    expect(lifo).toBe(true);
  });

  test("deep nested generator throws preserve the original cause", async () => {
    const depth = 20_000;
    const cause = new Error("deep generator failed");
    const nested = (remaining: number): Op<never, never, []> =>
      Op(function* () {
        if (remaining === 0) throw cause;
        return yield* nested(remaining - 1);
      });

    const result = await nested(depth).run();

    assert(result.isErr(), "deep generator throw should settle as Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    expect(result.error.cause).toBe(cause);
  });

  test("a parent generator can catch a synchronous nested generator throw", async () => {
    const depth = 20_000;
    const cause = new Error("nested generator failed");
    let finalized = 0;
    const nested = (remaining: number): Op<never, never, []> =>
      Op(function* () {
        yield* Op.defer(() => {
          finalized += 1;
        });
        if (remaining === 0) throw cause;
        return yield* nested(remaining - 1);
      });
    const parent = Op(function* () {
      try {
        return yield* nested(depth);
      } catch (error) {
        expect(error).toBe(cause);
        return yield* Op.try(() => Promise.resolve("recovered"));
      }
    });

    const result = await parent.run();

    assert(result.isOk(), "parent catch should recover the nested generator throw");
    expect(result.value).toBe("recovered");
    expect(finalized).toBe(depth + 1);
  });

  test("deep nested rejections preserve the original cause", async () => {
    const depth = 20_000;
    const cause = new Error("deep suspension rejected");
    const nested = (remaining: number): Op<never, never, []> =>
      Op(function* () {
        if (remaining === 0) {
          return yield* Op.try(() => Promise.reject(cause));
        }
        return yield* nested(remaining - 1);
      });

    const result = await nested(depth).run();

    assert(result.isErr(), "deep rejected suspension should settle as Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    expect(result.error.cause).toBe(cause);
  });

  test("deep yield* composition preserves policy and lifecycle behavior", async () => {
    const depth = 20_000;
    const firstFailure = new Error("retry once");
    const events: string[] = [];
    let attempts = 0;
    const child = Op.try(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(firstFailure);
      return Promise.resolve(42);
    })
      .with(
        Policy.retry({
          retries: 1,
          when: (cause) => cause === firstFailure,
          delay: 0,
        }),
      )
      .on("enter", () => {
        events.push("enter");
      })
      .on("exit", () => {
        events.push("exit");
      });

    const nested = (remaining: number): Op<number, never, []> =>
      Op(function* () {
        if (remaining === 0) return yield* child;
        return yield* nested(remaining - 1);
      });

    const result = await nested(depth).run();

    assert(result.isOk(), "deep nested policy composition should succeed");
    expect(result.value).toBe(42);
    expect(attempts).toBe(2);
    expect(events).toEqual(["enter", "exit"]);
  });
});
