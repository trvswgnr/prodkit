import { UnhandledException } from "../errors.js";
import { raceAgainstAbortSignal } from "./abort-race.js";
import { Result } from "../result.js";
import {
  CUSTOM_INSTRUCTION_META,
  isErrInstruction,
  RegisterExitFinalizerInstruction,
  SuspendInstruction,
  type CustomInstruction,
  type Instruction,
} from "./instructions.js";
import type { Op } from "../index.js";
import { EMPTY_TUPLE } from "../shared.js";

/** Runtime execution context threaded through internal driver/suspend boundaries. */
export interface RunContext<A = []> {
  readonly signal: AbortSignal;
  readonly args: A;
  readonly extensions: ReadonlyMap<unknown, unknown>;
}

/**
 * Passed to {@link ExitFn} when the run unwinds.
 *
 * - `args` are the runtime inputs for this run
 * - `result` is the operation's pre-finalizer settlement result
 *   (including {@link UnhandledException} on the error channel when relevant).
 *   If a finalizer throws, `.run()` returns a new cleanup-failure result instead.
 */
export interface ExitContext<T, E, A = []> {
  readonly signal: AbortSignal;
  readonly args: A;
  readonly result: Result<T, E | UnhandledException>;
}

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

type ExitFinalizer = (ctx: ExitContext<unknown, unknown, readonly unknown[]>) => PromiseLike<void>;

function awaitSuspendedWithOptionalInterrupt<TValue>(
  suspended: PromiseLike<TValue>,
  signal: AbortSignal,
  interruptOnAbort: boolean,
): PromiseLike<TValue> {
  if (!interruptOnAbort) return suspended;
  return raceAgainstAbortSignal(suspended, signal, {
    mode: "cooperativeSettle",
    getAbortReason: () => signal.reason,
  });
}

async function drainSuspended(suspended: PromiseLike<unknown>): Promise<void> {
  try {
    await suspended;
  } catch {
    // ignore: abort rejection or child settlement errors while draining fan-out/provision work
  }
}

async function resumeSuspendedInstruction<T, E, M>(
  instruction: SuspendInstruction,
  iterator: Iterator<Instruction<E, M>, T, unknown>,
  context: RunContext<readonly unknown[]>,
  interruptOnAbort: boolean,
): Promise<IteratorResult<Instruction<E, M>, T>> {
  const suspended = instruction.suspend(context);
  try {
    return iterator.next(
      await awaitSuspendedWithOptionalInterrupt(suspended, context.signal, interruptOnAbort),
    );
  } catch (cause) {
    if (interruptOnAbort && instruction.drainOnAbort) await drainSuspended(suspended);
    throw cause;
  }
}

async function resumeCustomInstruction<T, E, M>(
  instruction: CustomInstruction<unknown, unknown>,
  iterator: Iterator<Instruction<E, M>, T, unknown>,
  context: RunContext<readonly unknown[]>,
  interruptOnAbort: boolean,
): Promise<IteratorResult<Instruction<E, M>, T>> {
  return iterator.next(
    await awaitSuspendedWithOptionalInterrupt(
      Promise.resolve(instruction.resolve(context)),
      context.signal,
      interruptOnAbort,
    ),
  );
}

function registerExitFinalizerInstruction<T, E, M>(
  instruction: RegisterExitFinalizerInstruction,
  iterator: Iterator<Instruction<E, M>, T, unknown>,
  runArgs: readonly unknown[],
  finalizers: ExitFinalizer[],
): IteratorResult<Instruction<E, M>, T> {
  const argsAtRegistration = instruction.args ?? runArgs;
  finalizers.push((ctx) =>
    instruction.finalize({
      signal: ctx.signal,
      result: ctx.result,
      args: argsAtRegistration,
    }),
  );
  return iterator.next(undefined);
}

/** Run every finalizer LIFO; collect faults from each (later-registered runs first; all still run even if one throws). */
async function runFinalizersSafely(
  finalizers: readonly ExitFinalizer[],
  ctx: ExitContext<unknown, unknown, readonly unknown[]>,
): Promise<unknown | void> {
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
}

async function settleIteratorWithCleanup<T, E, M>(
  iter: Iterator<Instruction<E, M>, T, unknown>,
  context: RunContext<readonly unknown[]>,
  finalizers: readonly ExitFinalizer[],
  result: Result<T, E | UnhandledException>,
): Promise<Result<T, E | UnhandledException>> {
  closeGenerator(iter);
  const exitCtx: ExitContext<T, E, readonly unknown[]> = {
    signal: context.signal,
    args: context.args,
    result,
  };
  const cleanupFault = await runFinalizersSafely(finalizers, exitCtx);
  if (cleanupFault !== undefined) {
    return Result.err(new UnhandledException({ cause: cleanupFault }));
  }
  return result;
}

export async function driveIterator<T, E, M>(
  iter: Iterator<Instruction<E, M>, T, unknown>,
  context: RunContext<readonly unknown[]>,
  interruptOnAbort = false,
): Promise<Result<T, E | UnhandledException>> {
  const finalizers: ExitFinalizer[] = [];
  const settle = (result: Result<T, E | UnhandledException>) =>
    settleIteratorWithCleanup(iter, context, finalizers, result);

  try {
    let step = iter.next();
    while (!step.done) {
      try {
        if (step.value instanceof SuspendInstruction) {
          step = await resumeSuspendedInstruction(step.value, iter, context, interruptOnAbort);
          continue;
        }
        const instr = step.value;
        if (instr instanceof RegisterExitFinalizerInstruction) {
          step = registerExitFinalizerInstruction(instr, iter, context.args, finalizers);
          continue;
        }
        if (isCustomInstruction(instr)) {
          step = await resumeCustomInstruction(instr, iter, context, interruptOnAbort);
          continue;
        }
        if (isErrInstruction<E>(instr)) {
          return settle(Result.err(instr.error));
        }
        const invalidErr = new UnhandledException({
          cause: new TypeError("Op generator yielded an invalid instruction"),
        });
        return settle(Result.err(invalidErr));
      } catch (cause) {
        const unhandled = new UnhandledException({ cause });
        return settle(Result.err(unhandled));
      }
    }
    const value = await step.value;
    return settle(Result.ok(value));
  } catch (cause) {
    const unhandled = new UnhandledException({ cause });
    return settle(Result.err(unhandled));
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

export function runOp<T, E, M>(op: Op<T, E, [], M>): Promise<Result<T, E | UnhandledException>> {
  return drive(op, createRunContext(new AbortController().signal));
}
