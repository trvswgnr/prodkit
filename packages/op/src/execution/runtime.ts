import { CLEANUP_FAILURE_MESSAGE, ErrorGroup, UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { unsafeCoerce } from "@prodkit/shared/runtime";
import {
  CUSTOM_INSTRUCTION_META,
  isErrInstruction,
  NestedOpInstruction,
  RegisterExitFinalizerInstruction,
  SuspendInstruction,
  type CustomInstruction,
  type RuntimeInstruction,
} from "./instructions.js";
import {
  AbortSettlement,
  awaitWithAbort,
  drainInFlightWork,
  settlementForSuspendedWork,
} from "./abort-settlement.js";
import type { Op } from "../index.js";
import type { Plan } from "../plan/model.js";
import { EMPTY_TUPLE } from "../core/identity.js";
import { closeGenerator, runFinalizersSafely, type ExitFinalizer } from "./cleanup.js";

export { closeGenerator } from "./cleanup.js";

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

type ErasedPlan = Plan<unknown, unknown, unknown>;
type PlanExecutionJob = {
  readonly plan: ErasedPlan;
  readonly context: RunContext<readonly unknown[]>;
  readonly settlement: AbortSettlement;
  readonly resolve: (result: Result<unknown, unknown | UnhandledException>) => void;
  readonly reject: (cause: unknown) => void;
};

let activePlanExecutionCount = 0;
const planExecutionQueue: PlanExecutionJob[] = [];
let planExecutionPumpScheduled = false;
const MAX_SYNC_PLAN_EXECUTION_DEPTH = 128;

export function executePlan<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  settlement: AbortSettlement = AbortSettlement.passThrough,
): Promise<Result<T, E | UnhandledException>> {
  if (activePlanExecutionCount < MAX_SYNC_PLAN_EXECUTION_DEPTH) {
    return executePlanDirect(plan, context, settlement);
  }

  return enqueuePlanExecution(plan, context, settlement);
}

async function executePlanDirect<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  settlement: AbortSettlement,
): Promise<Result<T, E | UnhandledException>> {
  activePlanExecutionCount += 1;
  try {
    // SAFETY: driveIterator may return UnhandledException; executePlan widens E for settlement faults.
    return unsafeCoerce(await driveIterator(plan.iterate(), context, settlement));
  } finally {
    activePlanExecutionCount -= 1;
  }
}

function enqueuePlanExecution<T, E, M>(
  plan: Plan<T, E, M>,
  context: RunContext<readonly unknown[]>,
  settlement: AbortSettlement,
): Promise<Result<T, E | UnhandledException>> {
  return new Promise((resolve, reject) => {
    // SAFETY: queued jobs erase plan generics and restore them through the typed promise returned by executePlan.
    const erasedPlan: ErasedPlan = unsafeCoerce(plan);
    // SAFETY: the queued result is the same Result shape, with generics erased at the queue boundary only.
    const erasedResolve: PlanExecutionJob["resolve"] = unsafeCoerce(resolve);
    planExecutionQueue.push({
      plan: erasedPlan,
      context,
      settlement,
      resolve: erasedResolve,
      reject,
    });
    schedulePlanExecutionPump();
  });
}

function schedulePlanExecutionPump() {
  if (planExecutionPumpScheduled) return;
  planExecutionPumpScheduled = true;
  queueMicrotask(pumpPlanExecutionQueue);
}

function pumpPlanExecutionQueue() {
  planExecutionPumpScheduled = false;

  while (true) {
    const job = planExecutionQueue.shift();
    if (job === undefined) return;

    void executePlanDirect(job.plan, job.context, job.settlement).then(job.resolve, job.reject);
  }
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

type RuntimeIterator<E, M> = Iterator<RuntimeInstruction<E, M>, unknown, unknown>;
type RuntimeIteratorStep<E, M> = IteratorResult<RuntimeInstruction<E, M>, unknown>;
type RuntimeIteratorFrame<E, M> = {
  readonly iterator: RuntimeIterator<E, M>;
  readonly finalizerArgs: readonly unknown[] | undefined;
};

async function resolveSuspendedInstruction(
  instruction: SuspendInstruction,
  context: RunContext<readonly unknown[]>,
  driveSettlement: AbortSettlement,
): Promise<unknown> {
  const suspendWork = instruction.suspend(context);
  const { settlement, suspended } = settlementForSuspendedWork(driveSettlement, suspendWork);
  try {
    return await awaitWithAbort(suspended, context.signal, settlement);
  } catch (cause) {
    if (settlement.kind === "interruptAndDrainOnAbort") {
      await drainInFlightWork(suspended);
    }
    throw cause;
  }
}

async function resolveCustomInstruction(
  instruction: CustomInstruction<unknown, unknown>,
  context: RunContext<readonly unknown[]>,
  driveSettlement: AbortSettlement,
): Promise<unknown> {
  return awaitWithAbort(
    Promise.resolve(instruction.resolve(context)),
    context.signal,
    driveSettlement,
  );
}

function registerExitFinalizerInstruction(
  instruction: RegisterExitFinalizerInstruction,
  runArgs: readonly unknown[],
  frameArgs: readonly unknown[] | undefined,
  finalizers: ExitFinalizer[],
) {
  const argsAtRegistration = instruction.args ?? frameArgs ?? runArgs;
  finalizers.push((ctx) =>
    instruction.finalize({
      signal: ctx.signal,
      result: ctx.result,
      args: argsAtRegistration,
    }),
  );
}

function throwIntoIterator<E, M>(
  iterator: RuntimeIterator<E, M>,
  cause: unknown,
): RuntimeIteratorStep<E, M> {
  if (iterator.throw === undefined) throw cause;
  return iterator.throw(cause);
}

function advanceIteratorFrames<E, M>(
  frames: RuntimeIteratorFrame<E, M>[],
  throwing: boolean,
  initialValue: unknown,
): RuntimeIteratorStep<E, M> {
  let value = initialValue;

  while (true) {
    const frame = frames[frames.length - 1];
    if (frame === undefined) {
      throw new Error("Nested Op iterator stack lost its current frame");
    }

    try {
      return throwing ? throwIntoIterator(frame.iterator, value) : frame.iterator.next(value);
    } catch (cause) {
      if (frames.length === 1) throw cause;
      frames.pop();
      throwing = true;
      value = cause;
    }
  }
}

function enterNestedFrame<E, M>(
  frames: RuntimeIteratorFrame<E, M>[],
  parent: RuntimeIteratorFrame<E, M>,
  instruction: NestedOpInstruction<unknown, E, M>,
): RuntimeIteratorStep<E, M> {
  let iterator: RuntimeIterator<E, M>;
  try {
    iterator = instruction.iterate();
  } catch (cause) {
    return advanceIteratorFrames(frames, true, cause);
  }

  frames.push({
    iterator,
    finalizerArgs: instruction.finalizerArgs ?? parent.finalizerArgs,
  });
  return advanceIteratorFrames(frames, false, undefined);
}

async function settleIteratorWithCleanup<T, E, M>(
  frames: readonly RuntimeIteratorFrame<E, M>[],
  context: RunContext<readonly unknown[]>,
  finalizers: readonly ExitFinalizer[],
  result: Result<T, E | UnhandledException>,
): Promise<Result<T, E | UnhandledException>> {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame !== undefined) closeGenerator(frame.iterator);
  }
  const exitCtx: ExitContext<T, E, readonly unknown[]> = {
    signal: context.signal,
    args: context.args,
    result,
  };
  const cleanupFaults = await runFinalizersSafely(finalizers, exitCtx);
  if (cleanupFaults.length > 0) {
    const failures = result.isErr() ? [result.error, ...cleanupFaults] : cleanupFaults;
    const cause = new ErrorGroup(failures, CLEANUP_FAILURE_MESSAGE);
    const cleanupError = new UnhandledException({ cause });
    return Result.err(cleanupError);
  }
  return result;
}

export async function driveIterator<T, E, M>(
  iter: Iterator<RuntimeInstruction<E, M>, T, unknown>,
  context: RunContext<readonly unknown[]>,
  settlement: AbortSettlement = AbortSettlement.passThrough,
): Promise<Result<T, E | UnhandledException>> {
  const finalizers: ExitFinalizer[] = [];
  const rootFrame: RuntimeIteratorFrame<E, M> = {
    iterator: iter,
    finalizerArgs: undefined,
  };
  const frames: RuntimeIteratorFrame<E, M>[] = [rootFrame];
  const settle = (result: Result<T, E | UnhandledException>) =>
    settleIteratorWithCleanup(frames, context, finalizers, result);

  try {
    let step = advanceIteratorFrames(frames, false, undefined);
    while (true) {
      const current = frames[frames.length - 1];
      if (current === undefined) {
        throw new Error("Nested Op iterator stack lost its current frame");
      }

      if (step.done) {
        if (frames.length === 1) {
          // SAFETY: only the root iterator remains, so its completed value has the declared T.
          const value = await unsafeCoerce<T>(step.value);
          return settle(Result.ok(value));
        }

        frames.pop();
        step = advanceIteratorFrames(frames, false, step.value);
        continue;
      }

      try {
        if (step.value instanceof SuspendInstruction) {
          const value = await resolveSuspendedInstruction(step.value, context, settlement);
          step = advanceIteratorFrames(frames, false, value);
          continue;
        }
        const instr = step.value;
        if (instr instanceof RegisterExitFinalizerInstruction) {
          registerExitFinalizerInstruction(instr, context.args, current.finalizerArgs, finalizers);
          step = advanceIteratorFrames(frames, false, undefined);
          continue;
        }
        if (instr instanceof NestedOpInstruction) {
          step = enterNestedFrame(frames, current, instr);
          continue;
        }
        if (isCustomInstruction(instr)) {
          const value = await resolveCustomInstruction(instr, context, settlement);
          step = advanceIteratorFrames(frames, false, value);
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
