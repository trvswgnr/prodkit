import { UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import {
  isErrInstruction,
  RegisterExitFinalizerInstruction,
  SuspendInstruction,
} from "./instructions.js";
import {
  CUSTOM_INSTRUCTION_META,
  type CustomInstruction,
  type ExitContext,
  type Instruction,
  type RunContext,
} from "./types.js";
import type { Op } from "../index.js";
import { EMPTY_TUPLE } from "../shared.js";

export function createRunContext(
  signal: AbortSignal,
  args: readonly unknown[] = EMPTY_TUPLE,
  extensions: ReadonlyMap<unknown, unknown> = new Map(),
): RunContext<readonly unknown[]> {
  return { signal, args, extensions };
}

function isCustomInstruction(value: unknown): value is CustomInstruction<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    CUSTOM_INSTRUCTION_META in value &&
    "resolve" in value &&
    typeof value.resolve === "function"
  );
}

export function closeGenerator(iterator: Iterator<unknown, unknown, unknown>) {
  try {
    // we intentionally ignore the return payload bc only generator finalization matters
    iterator.return?.(undefined);
  } catch {
    // ignore cleanup faults so the original result/error is preserved
  }
}

/** Fold multiple teardown faults into a nested `Error.cause` chain (outer = first failure in LIFO unwind). */
export function chainCleanupFaults(faults: readonly unknown[]): unknown {
  if (faults.length === 0) return undefined;
  if (faults.length === 1) return faults[0];
  let chain = faults[faults.length - 1];
  for (let i = faults.length - 2; i >= 0; i--) {
    const f = faults[i];
    const msg = f instanceof Error ? f.message : String(f);
    const name = f instanceof Error ? f.name : "Error";
    const layer = new Error(msg, { cause: chain });
    layer.name = name;
    chain = layer;
  }
  return chain;
}

export async function drive<T, E, M>(
  op: Op<T, E, [], M>,
  context: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>> {
  return driveInternal(op, context, false);
}

export async function driveInterruptOnAbort<T, E, M>(
  op: Op<T, E, [], M>,
  context: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>> {
  return driveInternal(op, context, true);
}

export async function driveIterator<T, E, M>(
  iter: Iterator<Instruction<E, M>, T, unknown>,
  context: RunContext<readonly unknown[]>,
  interruptOnAbort = false,
): Promise<Result<T, E | UnhandledException>> {
  const { signal, args: runArgs } = context;
  const finalizers: Array<
    (ctx: ExitContext<unknown, unknown, readonly unknown[]>) => PromiseLike<void>
  > = [];
  const awaitWithAbortInterrupt = <TValue>(suspended: PromiseLike<TValue>) => {
    if (!interruptOnAbort) return suspended;
    if (signal.aborted) return Promise.reject(signal.reason);

    return new Promise<TValue>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(signal.reason);
      };

      signal.addEventListener("abort", onAbort, { once: true });
      suspended.then(
        (value) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  };
  const resumeSuspended = async (
    instruction: SuspendInstruction,
    iterator: Iterator<Instruction<E, M>, T, unknown>,
  ) => iterator.next(await awaitWithAbortInterrupt(instruction.suspend(context)));
  const resumeCustom = async (
    instruction: CustomInstruction<unknown, unknown>,
    iterator: Iterator<Instruction<E, M>, T, unknown>,
  ) => iterator.next(await awaitWithAbortInterrupt(Promise.resolve(instruction.resolve(context))));
  const registerExitFinalizer = (
    instruction: RegisterExitFinalizerInstruction,
    iterator: Iterator<Instruction<E, M>, T, unknown>,
  ) => {
    const argsAtRegistration = instruction.args ?? runArgs;
    finalizers.push((ctx) =>
      instruction.finalize({
        signal: ctx.signal,
        result: ctx.result,
        args: argsAtRegistration,
      }),
    );
    return iterator.next(undefined);
  };
  /** Run every finalizer LIFO; collect faults from each (later-registered runs first; all still run even if one throws). */
  const runFinalizersSafely = async (
    ctx: ExitContext<unknown, unknown, readonly unknown[]>,
  ): Promise<unknown | void> => {
    const faults: unknown[] = [];
    for (let index = finalizers.length - 1; index >= 0; index -= 1) {
      const finalize = finalizers[index];
      if (finalize !== undefined) {
        try {
          await finalize(ctx);
        } catch (e) {
          faults.push(e);
        }
      }
    }
    if (faults.length === 0) {
      return undefined;
    }
    if (faults.length === 1) {
      return faults[0];
    }
    return chainCleanupFaults(faults);
  };
  const settleWithCleanup = async (
    result: Result<T, E | UnhandledException>,
  ): Promise<Result<T, E | UnhandledException>> => {
    closeGenerator(iter);
    const exitCtx: ExitContext<T, E, readonly unknown[]> = { signal, args: runArgs, result };
    const cleanupFault = await runFinalizersSafely(exitCtx);
    if (cleanupFault !== undefined) {
      return Result.err(new UnhandledException({ cause: cleanupFault }));
    }
    return result;
  };

  try {
    let step = iter.next();
    while (!step.done) {
      try {
        if (step.value instanceof SuspendInstruction) {
          step = await resumeSuspended(step.value, iter);
          continue;
        }
        const instr = step.value;
        if (instr instanceof RegisterExitFinalizerInstruction) {
          step = registerExitFinalizer(instr, iter);
          continue;
        }
        if (isCustomInstruction(instr)) {
          step = await resumeCustom(instr, iter);
          continue;
        }
        if (isErrInstruction<E>(instr)) {
          return settleWithCleanup(Result.err(instr.error));
        }
        const invalidErr = new UnhandledException({
          cause: new TypeError("Op generator yielded an invalid instruction"),
        });
        return settleWithCleanup(Result.err(invalidErr));
      } catch (cause) {
        const unhandled = new UnhandledException({ cause });
        return settleWithCleanup(Result.err(unhandled));
      }
    }
    const value = await step.value;
    return settleWithCleanup(Result.ok(value));
  } catch (cause) {
    const unhandled = new UnhandledException({ cause });
    return settleWithCleanup(Result.err(unhandled));
  }
}

async function driveInternal<T, E, M>(
  op: Op<T, E, [], M>,
  context: RunContext<readonly unknown[]>,
  interruptOnAbort: boolean,
): Promise<Result<T, E | UnhandledException>> {
  try {
    const ef = typeof op === "function" ? op() : op;
    const iter = ef[Symbol.iterator]();
    return driveIterator(iter, context, interruptOnAbort);
  } catch (cause) {
    const unhandled = new UnhandledException({ cause });
    return Result.err(unhandled);
  }
}
