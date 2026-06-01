import { ErrorGroup, UnhandledException } from "./errors.js";
import type { RunContext } from "./core/runtime.js";
import type { AnyNullaryOp, InferOpMeta, InferOpOk, InferOpErr } from "./core/plan/surface.js";
import type { Instruction } from "./core/instructions.js";
import type { EmptyMeta, MergeMeta } from "./core/meta.js";
import type { Op } from "./index.js";
import { allPlan } from "./core/plan/combinators.js";
import { getPlan } from "./core/plan/base.js";
import { makePlanOp } from "./core/plan/shell.js";
import { makeCoreOp } from "./core/fluent.js";
import { SuspendInstruction, SuspendResume } from "./core/instructions.js";
import { createRunContext, drive, driveInterruptOnAbort } from "./core/runtime.js";
import { Result } from "./result.js";
import { EMPTY_TUPLE, unsafeCoerce } from "./shared.js";

type MergeOpsMeta<Ops extends readonly AnyNullaryOp[]> = Ops extends readonly [
  infer Head extends AnyNullaryOp,
  ...infer Tail extends readonly AnyNullaryOp[],
]
  ? MergeMeta<InferOpMeta<Head>, MergeOpsMeta<Tail>>
  : EmptyMeta;

function makeCombinatorOp<T, E, M = EmptyMeta>(
  gen: () => Generator<Instruction<E>, T, unknown>,
): Op<T, E, [], M> {
  return makeCoreOp<T, E, M>(
    // SAFETY: combinator generators yield runtime instructions; M is declared on the returned Op.
    () => unsafeCoerce(gen()),
  );
}

type FanOut<T, E> = {
  runs: readonly PromiseLike<Result<T, E | UnhandledException>>[];
  controllers: readonly AbortController[];
  detach: () => void;
};

type FirstSettlerClaim<T, E> = (
  result: Result<T, E | UnhandledException>,
  hasWinner: boolean,
) => boolean;

/**
 * Unbounded fan-out shared by `Op.all`, `Op.any`, and `Op.race`:
 * start all children, claim on first matching result, abort siblings, wait for every branch,
 * then detach the parent abort listener.
 */
async function driveFirstSettlerFanOut<T, E>(
  ops: readonly Op<T, E, []>[],
  outerContext: RunContext<readonly unknown[]>,
  shouldClaim: FirstSettlerClaim<T, E>,
): Promise<Result<T, E | UnhandledException>[]> {
  const fan = fanOut(ops, outerContext, driveInterruptOnAbort);
  let winnerClaimed = false;

  const results = await Promise.all(
    fan.runs.map((run, index) =>
      run.then((result) => {
        if (!winnerClaimed && shouldClaim(result, winnerClaimed)) {
          winnerClaimed = true;
          fan.controllers.forEach((controller, controllerIndex) => {
            if (controllerIndex !== index) controller.abort();
          });
        }
        return result;
      }),
    ),
  );

  fan.detach();
  return results;
}

type DriveChild = <T, E, M>(
  op: Op<T, E, [], M>,
  context: RunContext<readonly unknown[]>,
) => Promise<Result<T, E | UnhandledException>>;

/**
 * Fan-out contract:
 * - Every child gets its own AbortController so winner/loser cancellation can be isolated
 * - We check `outerSignal.aborted` before adding a listener so already-cancelled parents
 *   synchronously cascade into children instead of missing the abort edge
 * - Callers must invoke `detach()` once the combinator settles to avoid retaining listeners
 * - Pass `driveInterruptOnAbort` when aborted branches must unwind even if they never observe
 *   the signal (`Op.all`, `Op.race`, `Op.any`); pass `drive` for cooperative-only fan-out
 *   (`Op.allSettled`)
 */
function fanOut<T, E>(
  ops: readonly Op<T, E, []>[],
  outerContext: RunContext<readonly unknown[]>,
  driveChild: DriveChild,
): FanOut<T, E> {
  const entries = ops.map((op) => ({ op, controller: new AbortController() }));
  const cascade = () => entries.forEach((e) => e.controller.abort(outerContext.signal.reason));

  if (outerContext.signal.aborted) cascade();
  else outerContext.signal.addEventListener("abort", cascade, { once: true });

  const detach = () => outerContext.signal.removeEventListener("abort", cascade);
  const controllers = entries.map((e) => e.controller);
  const runs = entries.map((e) =>
    driveChild(
      e.op,
      createRunContext(e.controller.signal, outerContext.args, outerContext.extensions),
    ),
  );

  return { runs, controllers, detach };
}

function concurrencyLimit(
  concurrency: number | undefined,
  size: number,
): Result<number, UnhandledException> {
  if (concurrency === undefined) return Result.ok(size);

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    const cause = new RangeError("concurrency must be a positive integer");
    return Result.err(new UnhandledException({ cause }));
  }

  return Result.ok(Math.min(concurrency, size));
}

type BoundedPoolConfig<T, E> = {
  continueScheduling: () => boolean;
  driveChild: DriveChild;
  onResult?: (
    result: Result<T, E | UnhandledException>,
    activeControllers: ReadonlySet<AbortController>,
  ) => void;
};

/**
 * Bounded worker pool shared by `Op.all` and `Op.allSettled`.
 * Parameterize fail-fast scheduling, child driver, and per-result sibling abort.
 */
async function driveBoundedPool<T, E>(
  ops: readonly Op<T, E, []>[],
  outerContext: RunContext<readonly unknown[]>,
  poolSize: number,
  config: BoundedPoolConfig<T, E>,
): Promise<Array<Result<T, E | UnhandledException> | undefined>> {
  const controllers = new Set<AbortController>();
  const cascade = () => controllers.forEach((c) => c.abort(outerContext.signal.reason));

  if (outerContext.signal.aborted) cascade();
  else outerContext.signal.addEventListener("abort", cascade, { once: true });

  const results = Array<Result<T, E | UnhandledException> | undefined>(ops.length);
  let nextIndex = 0;

  const worker = async () => {
    while (config.continueScheduling()) {
      const i = nextIndex;
      nextIndex += 1;
      const op = ops[i];
      if (op === undefined) return;
      const controller = new AbortController();
      controllers.add(controller);
      if (outerContext.signal.aborted) controller.abort(outerContext.signal.reason);
      const res = await config.driveChild(
        op,
        createRunContext(controller.signal, outerContext.args, outerContext.extensions),
      );
      controllers.delete(controller);
      results[i] = res;
      config.onResult?.(res, controllers);
    }
  };

  const detach = () => outerContext.signal.removeEventListener("abort", cascade);

  await Promise.all(Array(poolSize).fill(undefined).map(worker)).finally(detach);

  return results;
}

type AllOpOk<Ops extends readonly AnyNullaryOp[]> = { [K in keyof Ops]: InferOpOk<Ops[K]> };
type AllOpErr<Ops extends readonly AnyNullaryOp[]> = InferOpErr<Ops[number]>;

function collectAllSettled<T, E>(
  results: ReadonlyArray<Result<T, E | UnhandledException> | undefined>,
): Result<Result<T, E | UnhandledException>[], UnhandledException> {
  const settled: Result<T, E | UnhandledException>[] = [];

  for (const [index, result] of results.entries()) {
    if (result === undefined)
      return Result.err(
        new UnhandledException({
          cause: new Error(`Op combinator invariant violation: missing result at index ${index}`),
        }),
      );
    settled.push(result);
  }

  return Result.ok(settled);
}

export function allOp<const Ops extends readonly AnyNullaryOp[]>(
  ops: Ops,
  concurrency?: number,
): Op<AllOpOk<Ops>, AllOpErr<Ops>, [], MergeOpsMeta<Ops>> {
  const snapshot = ops.slice();
  const bindAllPlan = () =>
    allPlan(
      snapshot.map((op) => getPlan(op, EMPTY_TUPLE)),
      concurrency,
    );

  // SAFETY: plan-backed binder preserves combinator tuple inference from snapshot ops.
  return unsafeCoerce(makePlanOp(bindAllPlan, bindAllPlan, true));
}

type AllSettledOpOk<Ops extends readonly AnyNullaryOp[]> = {
  [K in keyof Ops]: Result<InferOpOk<Ops[K]>, InferOpErr<Ops[K]> | UnhandledException>;
};
export function allSettledOp<const Ops extends readonly AnyNullaryOp[]>(
  ops: Ops,
  concurrency?: number,
): Op<AllSettledOpOk<Ops>, never, [], MergeOpsMeta<Ops>> {
  const snapshot = ops.slice();

  return makeCombinatorOp(function* () {
    const result: Result<AllSettledOpOk<Ops>, never> = yield* new SuspendInstruction(
      (outerContext) => driveAllSettled(snapshot, outerContext, concurrency),
      SuspendResume.passThrough,
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

export function settleOp<T, E, M>(
  op: Op<T, E, [], M>,
): Op<Result<T, E | UnhandledException>, never, [], M> {
  return makeCombinatorOp(function* () {
    return yield* new SuspendInstruction(
      (outerContext) => drive(op, outerContext),
      SuspendResume.passThrough,
    );
  });
}

/**
 * Drives the `Op.allSettled` combinator
 *
 * Concurrency contract (`Op.allSettled`, bounded mode):
 * - Up to `concurrency` children run at once
 * - Child failures never abort siblings; every child is allowed to finish
 * - Settle result preserves input order and includes each branch outcome
 */
async function driveAllSettled<T, E>(
  ops: readonly Op<T, E, []>[],
  outerContext: RunContext<readonly unknown[]>,
  concurrency: number | undefined,
): Promise<Result<Result<T, E | UnhandledException>[], UnhandledException>> {
  const limit = concurrencyLimit(concurrency, ops.length);

  if (limit.isErr()) return limit;

  if (ops.length === 0) return Result.ok([]);

  if (limit.value >= ops.length) {
    const results = await driveAllSettledUnbounded(ops, outerContext);
    return Result.ok(results);
  }

  const results = await driveBoundedPool(ops, outerContext, limit.value, {
    continueScheduling: () => true,
    driveChild: drive,
  });

  return collectAllSettled(results);
}

async function driveAllSettledUnbounded<T, E>(
  ops: readonly Op<T, E, []>[],
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>[]> {
  const fan = fanOut(ops, outerContext, drive);
  const results = await Promise.all(fan.runs);
  fan.detach();
  return results;
}

/**
 * helper to check if any op in the list has an infallible error type
 */
type HasInfallibleOp<Ops extends readonly AnyNullaryOp[]> = Ops extends readonly [
  infer Head extends AnyNullaryOp,
  ...infer Tail extends readonly AnyNullaryOp[],
]
  ? [InferOpErr<Head>] extends [never]
    ? true
    : HasInfallibleOp<Tail>
  : false;

type AnyOpOk<Ops extends readonly AnyNullaryOp[]> = InferOpOk<Ops[number]>;
type AnyOpErr<Ops extends readonly AnyNullaryOp[]> =
  HasInfallibleOp<Ops> extends true ? never : ErrorGroup<InferOpErr<Ops[number]>>;

export function anyOp<const Ops extends readonly AnyNullaryOp[]>(
  ops: Ops,
): Op<AnyOpOk<Ops>, AnyOpErr<Ops>, [], MergeOpsMeta<Ops>> {
  const snapshot = ops.slice();

  return makeCombinatorOp(function* () {
    const result: Result<AnyOpOk<Ops>, AnyOpErr<Ops>> = yield* new SuspendInstruction(
      (outerContext) => driveAny(snapshot, outerContext),
      SuspendResume.passThrough,
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

/**
 * Drives the `Op.any` combinator
 *
 * Concurrency contract (`Op.any`):
 * - All children run concurrently
 * - First successful child becomes the winner and aborts remaining siblings
 * - The combinator still waits for aborted losers to settle so cleanup/finalizers complete
 * - Fan-out uses `driveInterruptOnAbort` so losers unwind even when they ignore abort
 * - If no success exists, returns ErrorGroup with errors in input order
 *
 * `Op.any` waits for aborted losers to settle so cleanup/finalizers finish
 * deterministically before run() returns; winner success still takes precedence
 */
async function driveAny<T, E>(
  ops: readonly Op<T, E, []>[],
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, ErrorGroup<E | UnhandledException>>> {
  if (ops.length === 0) {
    const e = Result.err(new ErrorGroup([], "Op.any requires at least one operation"));
    return Promise.resolve(e);
  }

  let winner: { value: T } | undefined;
  const results = await driveFirstSettlerFanOut(ops, outerContext, (result) => {
    if (result.isOk() && winner === undefined) {
      winner = { value: result.value };
      return true;
    }
    return false;
  });

  if (winner !== undefined) return Result.ok(winner.value);

  const errors = results.filter(Result.isError).map((r) => r.error);
  return Result.err(new ErrorGroup(errors, "Op.any failed because all operations failed"));
}

type RaceOpOk<Ops extends readonly AnyNullaryOp[]> = InferOpOk<Ops[number]>;
type RaceOpErr<Ops extends readonly AnyNullaryOp[]> = InferOpErr<Ops[number]>;
export function raceOp<const Ops extends readonly AnyNullaryOp[]>(
  ops: Ops,
): Op<RaceOpOk<Ops>, RaceOpErr<Ops>, [], MergeOpsMeta<Ops>> {
  const snapshot = ops.slice();
  return makeCombinatorOp(function* () {
    const result: Result<RaceOpOk<Ops>, RaceOpErr<Ops>> = yield* new SuspendInstruction(
      (outerContext) => driveRace(snapshot, outerContext),
      SuspendResume.passThrough,
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

/**
 * Drives the `Op.race` combinator
 *
 * Concurrency contract (`Op.race`):
 * - All children run concurrently
 * - First settler (Ok or Err) wins and aborts the rest
 * - The combinator waits for aborted losers to settle so cleanup/finalizers complete
 *   before returning the winner's outcome
 * - Fan-out uses `driveInterruptOnAbort` so losers unwind even when they ignore abort
 *
 * `Op.race` returns the first settler's outcome, but waits for aborted
 * losers to settle so cleanup/finalizers complete before run() returns
 */
async function driveRace<T, E>(
  ops: readonly Op<T, E, []>[],
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>> {
  if (ops.length === 0) {
    const cause = new Error("Op.race requires at least one operation");
    return Promise.resolve(Result.err(new UnhandledException({ cause })));
  }

  let winner: Result<T, E | UnhandledException> | undefined;
  await driveFirstSettlerFanOut(ops, outerContext, (_result, hasWinner) => {
    if (!hasWinner) {
      winner = _result;
      return true;
    }
    return false;
  });

  if (winner !== undefined) return winner;

  const cause = new Error("Op.race failed to produce a winner");
  return Result.err(new UnhandledException({ cause }));
}
