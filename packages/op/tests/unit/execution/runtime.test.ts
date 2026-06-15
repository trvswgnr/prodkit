import { NEVER, unsafeCoerce } from "@prodkit/shared/runtime";
import { assert, describe, expect, test } from "vitest";
import { closeGenerator, runFinalizersSafely } from "../../../src/execution/cleanup.js";
import { createRunContext, drive } from "../../../src/execution/runtime.js";
import { makeCoreOp } from "../../../src/core/builders.js";
import {
  CUSTOM_INSTRUCTION_META,
  isErrInstruction,
  type CustomInstruction,
  type Instruction,
  RegisterExitFinalizerInstruction,
  SuspendInstruction,
} from "../../../src/execution/instructions.js";
import type { RunContext } from "../../../src/execution/runtime.js";
import type { EmptyMeta } from "../../../src/core/metadata.js";
import { Op } from "../../../src/index.js";
import { CLEANUP_FAILURE_MESSAGE, ErrorGroup, UnhandledException } from "../../../src/errors.js";
import { Result } from "../../../src/result.js";

class ThrowingCustomInstruction implements CustomInstruction<never, EmptyMeta> {
  readonly [CUSTOM_INSTRUCTION_META] = NEVER;

  resolve(_context: RunContext): never {
    throw new Error("resolve-threw");
  }

  *[Symbol.iterator](): Generator<this, never, unknown> {
    // SAFETY: ThrowingCustomInstruction is a CustomInstruction and its yield type matches resolve.
    return unsafeCoerce(yield this);
  }
}

class RejectingCustomInstruction implements CustomInstruction<never, EmptyMeta> {
  readonly [CUSTOM_INSTRUCTION_META] = NEVER;

  resolve(_context: RunContext): Promise<never> {
    return Promise.reject(new Error("resolve-rejected"));
  }

  *[Symbol.iterator](): Generator<this, never, unknown> {
    // SAFETY: RejectingCustomInstruction is a CustomInstruction and its yield type matches resolve.
    return unsafeCoerce(yield this);
  }
}

function makeRuntimeOp<T, E>(gen: () => Generator<Instruction<E>, T, unknown>): Op<T, E, []> {
  return makeCoreOp(gen);
}

describe("execution cleanup helpers", () => {
  test("runFinalizersSafely preserves exact fault values in LIFO order", async () => {
    const firstRegisteredFault = { source: "first" };
    const lastRegisteredFault = new Error("last");
    const faults = await runFinalizersSafely(
      [
        async () => {
          throw firstRegisteredFault;
        },
        async () => {
          throw undefined;
        },
        async () => {
          throw lastRegisteredFault;
        },
      ],
      {
        signal: new AbortController().signal,
        args: [],
        result: Result.ok("done"),
      },
    );

    expect(faults).toEqual([lastRegisteredFault, undefined, firstRegisteredFault]);
  });

  test("closeGenerator swallows iterator.return failures", () => {
    let called = false;
    const iterator = {
      next: () => ({ done: true as const, value: undefined }),
      return: () => {
        called = true;
        throw new Error("boom");
      },
    };

    expect(() => closeGenerator(iterator)).not.toThrow();
    expect(called).toBe(true);
  });

  test("instruction type guards correctly classify values", () => {
    const suspended = new SuspendInstruction(async () => 1);
    const finalizer = new RegisterExitFinalizerInstruction(async () => {}, undefined);
    const typedErr = Result.err("typed");
    const typedOk = Result.ok("value");

    expect(suspended instanceof SuspendInstruction).toBe(true);
    expect({ suspend: async () => 1 } instanceof SuspendInstruction).toBe(false);

    expect(finalizer instanceof RegisterExitFinalizerInstruction).toBe(true);
    expect({ finalize: async () => {} } instanceof RegisterExitFinalizerInstruction).toBe(false);

    expect(isErrInstruction(typedErr)).toBe(true);
    expect(isErrInstruction(typedOk)).toBe(false);
    expect(isErrInstruction({ isErr: () => false, error: "x" })).toBe(false);
    expect(isErrInstruction("nope")).toBe(false);
  });
});

describe("drive runtime behavior", () => {
  test("resumeSuspended path passes the bound signal to suspend work", async () => {
    let seenSignal: AbortSignal | undefined;
    const op = makeRuntimeOp<number, never>(function* () {
      const value = yield new SuspendInstruction(async (context) => {
        seenSignal = context.signal;
        return 69;
      });
      // SAFETY: SuspendInstruction resume type matches the generator's declared success type.
      return unsafeCoerce<number>(value) + 1;
    });

    const signal = new AbortController().signal;
    const result = await drive(op, createRunContext(signal));

    assert(result.isOk(), "result should be Ok");
    expect(result.value).toBe(70);
    expect(seenSignal).toBe(signal);
  });

  test("resumeCustom converts a thrown resolve into Err(UnhandledException)", async () => {
    const op: Op<never, never, []> = Op(function* () {
      return yield* new ThrowingCustomInstruction();
    });

    const result = await op.run();

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    const cause = result.error.cause;
    expect(cause).toBeInstanceOf(Error);
    assert(cause instanceof Error);
    expect(cause.message).toBe("resolve-threw");
  });

  test("resumeCustom converts a rejected resolve into Err(UnhandledException)", async () => {
    const op: Op<never, never, []> = Op(function* () {
      return yield* new RejectingCustomInstruction();
    });

    const result = await op.run();

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    const cause = result.error.cause;
    expect(cause).toBeInstanceOf(Error);
    assert(cause instanceof Error);
    expect(cause.message).toBe("resolve-rejected");
  });

  test("invalid yielded instructions return Err(UnhandledException(TypeError))", async () => {
    const op = makeRuntimeOp<number, never>(function* () {
      // SAFETY: deliberately yield a non-instruction value to exercise runtime validation.
      yield unsafeCoerce({ _tag: "NotAnInstruction" });
      return 1;
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    expect(result.error.cause).toBeInstanceOf(TypeError);
  });

  test("registerExitFinalizer runs all handlers in LIFO order", async () => {
    const seen: string[] = [];
    const op = makeRuntimeOp<number, never>(function* () {
      yield new RegisterExitFinalizerInstruction(async (ctx) => {
        seen.push(`first-${ctx.result.isOk() ? "ok" : "err"}`);
      }, undefined);
      yield new RegisterExitFinalizerInstruction(async (ctx) => {
        seen.push(`second-${ctx.result.isOk() ? "ok" : "err"}`);
      }, undefined);
      return 123;
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    assert(result.isOk(), "result should be Ok");
    expect(result.value).toBe(123);
    expect(seen).toEqual(["second-ok", "first-ok"]);
  });

  test("successful body with successful cleanup preserves Ok", async () => {
    const op = makeRuntimeOp<string, never>(function* () {
      yield new RegisterExitFinalizerInstruction(async () => {}, undefined);
      return "ok";
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    assert(result.isOk(), "result should be Ok");
    expect(result.value).toBe("ok");
  });

  test("successful body with failed cleanup returns UnhandledException(ErrorGroup)", async () => {
    const cleanupFault = new Error("cleanup-failed");
    const op = makeRuntimeOp<string, never>(function* () {
      yield new RegisterExitFinalizerInstruction(async () => {
        throw cleanupFault;
      }, undefined);
      return "ok";
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    expect(result.error.cause).toBeInstanceOf(ErrorGroup);
    assert(result.error.cause instanceof ErrorGroup);
    expect(result.error.cause.message).toBe(CLEANUP_FAILURE_MESSAGE);
    expect(result.error.cause.errors).toEqual([cleanupFault]);
  });

  test("known body failure with successful cleanup preserves Err(E)", async () => {
    const bodyFault = { type: "known" };
    const op = makeRuntimeOp<never, typeof bodyFault>(function* () {
      yield new RegisterExitFinalizerInstruction(async () => {}, undefined);
      return yield* Result.err(bodyFault);
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBe(bodyFault);
  });

  test("known body failure with failed cleanup preserves both in ErrorGroup", async () => {
    const bodyFault = { type: "known" };
    const cleanupFault = new Error("cleanup-failed");
    const op = makeRuntimeOp<never, typeof bodyFault>(function* () {
      yield new RegisterExitFinalizerInstruction(async () => {
        throw cleanupFault;
      }, undefined);
      return yield* Result.err(bodyFault);
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    expect(result.error.cause).toBeInstanceOf(ErrorGroup);
    assert(result.error.cause instanceof ErrorGroup);
    expect(result.error.cause.errors).toEqual([bodyFault, cleanupFault]);
  });

  test("unexpected body failure with successful cleanup preserves the original UnhandledException", async () => {
    const bodyCause = new Error("body-failed");
    let preCleanupFailure: unknown;
    const op = makeRuntimeOp<never, never>(function* () {
      yield new RegisterExitFinalizerInstruction(async (ctx) => {
        assert(ctx.result.isErr(), "pre-cleanup result should be Err");
        preCleanupFailure = ctx.result.error;
      }, undefined);
      throw bodyCause;
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBe(preCleanupFailure);
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    expect(result.error.cause).toBe(bodyCause);
  });

  test("unexpected body failure with failed cleanup preserves both in ErrorGroup", async () => {
    const bodyCause = new Error("body-failed");
    const cleanupFault = { type: "cleanup" };
    let preCleanupFailure: unknown;
    const failsUnexpectedly = Op.try(() => {
      throw bodyCause;
    });
    const op = Op(function* () {
      yield new RegisterExitFinalizerInstruction(async (ctx) => {
        if (ctx.result.isErr()) {
          preCleanupFailure = ctx.result.error;
        }
        throw cleanupFault;
      }, undefined);
      return yield* failsUnexpectedly;
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    if (!result.isErr()) throw new Error("result should be Err");
    const outerError = result.error;
    if (!(outerError instanceof UnhandledException)) {
      throw new Error("result error should be UnhandledException");
    }
    if (outerError === preCleanupFailure) {
      throw new Error("cleanup failure should produce a new UnhandledException");
    }
    const group = outerError.cause;
    if (!(group instanceof ErrorGroup)) {
      throw new Error("UnhandledException cause should be ErrorGroup");
    }
    if (group.errors.length !== 2) {
      throw new Error("cleanup ErrorGroup should contain two failures");
    }
    if (group.errors[0] !== preCleanupFailure) {
      throw new Error("first grouped failure should be the original UnhandledException");
    }
    if (group.errors[1] !== cleanupFault) {
      throw new Error("second grouped failure should be the cleanup fault");
    }
  });

  test("cleanup ErrorGroup preserves custom errors and non-Error values in LIFO order", async () => {
    class CleanupError extends Error {
      readonly code = "CLEANUP_FAILED";
    }

    const firstRegisteredFault = { type: "plain-value" };
    const middleRegisteredFault = Object.assign(new Error("middle"), { resourceId: "db-1" });
    const lastRegisteredFault = new CleanupError("last");
    const op = makeRuntimeOp<string, never>(function* () {
      yield new RegisterExitFinalizerInstruction(async () => {
        throw firstRegisteredFault;
      }, undefined);
      yield new RegisterExitFinalizerInstruction(async () => {
        throw middleRegisteredFault;
      }, undefined);
      yield new RegisterExitFinalizerInstruction(async () => {
        throw lastRegisteredFault;
      }, undefined);
      return "done";
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    expect(result.error.cause).toBeInstanceOf(ErrorGroup);
    assert(result.error.cause instanceof ErrorGroup);
    expect(result.error.cause.errors).toEqual([
      lastRegisteredFault,
      middleRegisteredFault,
      firstRegisteredFault,
    ]);
    expect(result.error.cause.errors[0]).toBeInstanceOf(CleanupError);
    expect(result.error.cause.errors[1]).toHaveProperty("resourceId", "db-1");
  });
});

describe("execution depth", () => {
  test("generator yield* loop returns the correct value at depth 50_000", async () => {
    const depth = 50_000;
    const op = Op(function* () {
      let acc = 0;
      for (let i = 0; i < depth; i += 1) acc += yield* Op.of(1);
      return acc;
    });

    const result = await op.run();

    assert(result.isOk(), "generator loop should succeed");
    expect(result.value).toBe(depth);
  });

  test("flatMap chain returns the correct value at depth 20_000", async () => {
    const depth = 20_000;
    let op = Op.of(0);
    for (let i = 0; i < depth; i += 1) op = op.flatMap((x) => Op.of(x + 1));

    const result = await op.run();

    assert(result.isOk(), "deep flatMap chain should succeed");
    expect(result.value).toBe(depth);
  });
});
