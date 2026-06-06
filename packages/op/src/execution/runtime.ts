import { UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import {
  CUSTOM_INSTRUCTION_META,
  isErrInstruction,
  RegisterExitFinalizerInstruction,
  SuspendInstruction,
  type CustomInstruction,
  type Instruction,
} from "./instructions.js";
import {
  AbortSettlement,
  awaitWithAbort,
  drainInFlightWork,
  settlementForSuspendedWork,
} from "./settlement.js";
import type { Op } from "../index.js";
import { EMPTY_TUPLE } from "../core/identity.js";
import { closeGenerator, runFinalizersSafely, type ExitFinalizer } from "./cleanup.js";

export { closeGenerator, chainCleanupFaults } from "./cleanup.js";

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

export async function drive<T, E, M>(
  op: Op<T, E, [], M>,
  context: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>> {
  return driveInternal(op, context, AbortSettlement.passThrough);
}

async function resumeSuspendedInstruction<T, E, M>(
  instruction: SuspendInstruction,
  iterator: Iterator<Instruction<E, M>, T, unknown>,
  context: RunContext<readonly unknown[]>,
  driveSettlement: AbortSettlement,
): Promise<IteratorResult<Instruction<E, M>, T>> {
  const suspendWork = instruction.suspend(context);
  const { settlement, suspended } = settlementForSuspendedWork(driveSettlement, suspendWork);
  try {
    return iterator.next(await awaitWithAbort(suspended, context.signal, settlement));
  } catch (cause) {
    if (settlement.kind === "interruptAndDrainOnAbort") {
      await drainInFlightWork(suspended);
    }
    throw cause;
  }
}

async function resumeCustomInstruction<T, E, M>(
  instruction: CustomInstruction<unknown, unknown>,
  iterator: Iterator<Instruction<E, M>, T, unknown>,
  context: RunContext<readonly unknown[]>,
  driveSettlement: AbortSettlement,
): Promise<IteratorResult<Instruction<E, M>, T>> {
  return iterator.next(
    await awaitWithAbort(
      Promise.resolve(instruction.resolve(context)),
      context.signal,
      driveSettlement,
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
  settlement: AbortSettlement = AbortSettlement.passThrough,
): Promise<Result<T, E | UnhandledException>> {
  const finalizers: ExitFinalizer[] = [];
  const settle = (result: Result<T, E | UnhandledException>) =>
    settleIteratorWithCleanup(iter, context, finalizers, result);

  try {
    let step = iter.next();
    while (!step.done) {
      try {
        if (step.value instanceof SuspendInstruction) {
          step = await resumeSuspendedInstruction(step.value, iter, context, settlement);
          continue;
        }
        const instr = step.value;
        if (instr instanceof RegisterExitFinalizerInstruction) {
          step = registerExitFinalizerInstruction(instr, iter, context.args, finalizers);
          continue;
        }
        if (isCustomInstruction(instr)) {
          step = await resumeCustomInstruction(instr, iter, context, settlement);
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
  settlement: AbortSettlement,
): Promise<Result<T, E | UnhandledException>> {
  try {
    const ef = typeof op === "function" ? op() : op;
    const iter = ef[Symbol.iterator]();
    return driveIterator(iter, context, settlement);
  } catch (cause) {
    const unhandled = new UnhandledException({ cause });
    return Result.err(unhandled);
  }
}

export function runOp<T, E, M>(op: Op<T, E, [], M>): Promise<Result<T, E | UnhandledException>> {
  return drive(op, createRunContext(new AbortController().signal));
}
