import { NEVER, unsafeCoerce } from "@prodkit/shared/runtime";
import { assert, describe, expect, test } from "vitest";
import { chainCleanupFaults, closeGenerator } from "../../../src/execution/cleanup.js";
import { createRunContext, drive } from "../../../src/execution/runtime.js";
import { makeCoreOp } from "../../../src/core/generator.js";
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
import { UnhandledException } from "../../../src/errors.js";
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
  test("chainCleanupFaults handles empty, single, and multi-fault chains", () => {
    expect(chainCleanupFaults([])).toBeUndefined();

    const only = new Error("only");
    expect(chainCleanupFaults([only])).toBe(only);

    const first = new Error("first");
    const second = "second-non-error";
    const third = new Error("third");
    const chain = chainCleanupFaults([first, second, third]);
    expect(chain).toBeInstanceOf(Error);
    assert(chain instanceof Error);
    const outer = chain;
    expect(outer.message).toBe("first");
    assert(outer.cause instanceof Error);
    expect(outer.cause.message).toBe("second-non-error");
    assert(outer.cause.cause instanceof Error);
    expect(outer.cause.cause.message).toBe("third");
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

  test("finalizer throw after successful body converts to UnhandledException", async () => {
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
    expect(result.error.cause).toBe(cleanupFault);
  });

  test("cleanup fault takes precedence over typed body error", async () => {
    const cleanupFault = new Error("cleanup-failed");
    const op = makeRuntimeOp<never, string>(function* () {
      yield new RegisterExitFinalizerInstruction(async () => {
        throw cleanupFault;
      }, undefined);
      return yield* Result.err("typed-body-error");
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    expect(result.error.cause).toBe(cleanupFault);
  });

  test("multiple throwing finalizers are folded into a cause chain", async () => {
    const firstUnwindFault = new Error("second-registered-runs-first");
    const secondUnwindFault = "first-registered-runs-second";
    const op = makeRuntimeOp<string, never>(function* () {
      yield new RegisterExitFinalizerInstruction(async () => {
        throw secondUnwindFault;
      }, undefined);
      yield new RegisterExitFinalizerInstruction(async () => {
        throw firstUnwindFault;
      }, undefined);
      return "done";
    });

    const result = await drive(op, createRunContext(new AbortController().signal));

    assert(result.isErr(), "result should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    assert(result.error instanceof UnhandledException);
    assert(result.error.cause instanceof Error);
    const outer = result.error.cause;
    expect(outer.message).toBe("second-registered-runs-first");
    expect(outer.cause).toBe("first-registered-runs-second");
  });
});
