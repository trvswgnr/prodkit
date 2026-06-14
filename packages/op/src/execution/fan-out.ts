import { ErrorGroup, UnhandledException } from "../errors.js";
import { Result, type Err } from "../result.js";
import type { RunContext } from "./runtime.js";
import { createFanOutChildren } from "./child-run.js";
import { type Plan } from "../plan/model.js";
import { Settlement } from "./settlement.js";
import { unsafeCoerce } from "@prodkit/shared/runtime";

type ExecuteChildPlan = (
  plan: Plan<unknown, unknown, unknown>,
  context: RunContext<readonly unknown[]>,
) => Promise<Result<unknown, unknown | UnhandledException>>;

type FanOutSettleControls = {
  abortSiblingsExcept(keepIndex: number): void;
  abortActive(): void;
};

type DriveFanOutConfig<T, E> = {
  executeChild: ExecuteChildPlan;
  poolSize: number;
  shouldScheduleMore: () => boolean;
  onChildSettled?: (
    result: Result<T, E | UnhandledException>,
    index: number,
    controls: FanOutSettleControls,
  ) => void;
};

async function driveFanOutPlans<T, E>(
  plans: readonly Plan<T, E, unknown>[],
  outerContext: RunContext<readonly unknown[]>,
  config: DriveFanOutConfig<T, E>,
): Promise<Array<Result<T, E | UnhandledException> | undefined>> {
  const children = createFanOutChildren(outerContext);
  const results: Array<Result<T, E | UnhandledException> | undefined> = Array(plans.length);
  const runningByIndex = new Map<number, { abort(): void }>();

  const abortSiblingsExcept = (keepIndex: number) => {
    for (const [index, child] of runningByIndex) {
      if (index !== keepIndex) child.abort();
    }
  };

  const abortActive = () => {
    children.abortActive();
  };

  const controls = { abortSiblingsExcept, abortActive };
  const settleChild = (
    res: Result<T, E | UnhandledException>,
    index: number,
    slot: { release(): void },
  ) => {
    runningByIndex.delete(index);
    slot.release();
    results[index] = res;
    config.onChildSettled?.(res, index, controls);
  };

  try {
    if (config.poolSize >= plans.length) {
      const runs = plans.map((plan, index) => {
        const child = children.spawn();
        runningByIndex.set(index, child);
        return config.executeChild(plan, child.context).then((result) => {
          // SAFETY: ExecuteChildPlan types results as unknown; every plan here is Plan<T, E, ...> at this site.
          const res: Result<T, E | UnhandledException> = unsafeCoerce(result);
          settleChild(res, index, child);
          return res;
        });
      });

      await Promise.all(runs);
      return results;
    }

    let nextIndex = 0;
    const workerCount = Math.min(config.poolSize, plans.length);
    const worker = async () => {
      while (config.shouldScheduleMore()) {
        const i = nextIndex;
        nextIndex += 1;
        const plan = plans[i];
        if (plan === undefined) return;

        const child = children.spawn();
        runningByIndex.set(i, child);
        // SAFETY: ExecuteChildPlan types results as unknown; every plan here is Plan<T, E, ...> at this site.
        const res: Result<T, E | UnhandledException> = unsafeCoerce(
          await config.executeChild(plan, child.context),
        );
        settleChild(res, i, child);
      }
    };

    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
  } finally {
    children.detach();
  }
}

export function concurrencyLimit(
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

export function collectAllOk<T, E>(
  results: readonly (Result<T, E | UnhandledException> | undefined)[],
): Result<T[], E | UnhandledException> {
  const values: T[] = [];

  for (const [index, result] of results.entries()) {
    if (result === undefined)
      return Result.err(
        new UnhandledException({
          cause: new Error(`Op combinator invariant violation: missing result at index ${index}`),
        }),
      );
    if (result.isErr()) return result;
    values.push(result.value);
  }

  return Result.ok(values);
}

const executeInterruptingPlan: ExecuteChildPlan = (plan, context) =>
  Settlement.interrupting.runPlan(plan, context);

async function driveAllUnboundedPlans<T, E>(
  plans: readonly Plan<T, E, unknown>[],
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T[], E | UnhandledException>> {
  let firstErr: Err<T[], E | UnhandledException> | undefined;
  const results = await driveFanOutPlans(plans, outerContext, {
    poolSize: plans.length,
    executeChild: executeInterruptingPlan,
    shouldScheduleMore: () => firstErr === undefined,
    onChildSettled: (result, index, { abortSiblingsExcept }) => {
      if (result.isErr() && firstErr === undefined) {
        firstErr = result;
        abortSiblingsExcept(index);
      }
    },
  });

  if (firstErr !== undefined) return firstErr;

  return collectAllOk(results);
}

export async function driveAllPlans<T, E>(
  plans: readonly Plan<T, E, unknown>[],
  outerContext: RunContext<readonly unknown[]>,
  concurrency: number | undefined,
): Promise<Result<T[], E | UnhandledException>> {
  const limit = concurrencyLimit(concurrency, plans.length);

  if (limit.isErr()) return limit;

  if (plans.length === 0) return Result.ok([]);

  if (limit.value >= plans.length) return driveAllUnboundedPlans(plans, outerContext);

  let firstErr: Err<T, E | UnhandledException> | undefined;
  const results = await driveFanOutPlans(plans, outerContext, {
    poolSize: limit.value,
    executeChild: executeInterruptingPlan,
    shouldScheduleMore: () => firstErr === undefined,
    onChildSettled: (result, _index, { abortActive }) => {
      if (result.isErr() && firstErr === undefined) {
        firstErr = result;
        abortActive();
      }
    },
  });

  if (firstErr !== undefined) return firstErr;

  return collectAllOk(results);
}

export const executeCooperativePlan: ExecuteChildPlan = (plan, context) =>
  Settlement.cooperative.runPlan(plan, context);

export function collectAllSettled<T, E>(
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

async function driveAllSettledUnboundedPlans<T, E>(
  plans: readonly Plan<T, E, unknown>[],
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>[]> {
  const results = await driveFanOutPlans(plans, outerContext, {
    poolSize: plans.length,
    executeChild: executeCooperativePlan,
    shouldScheduleMore: () => true,
  });

  // SAFETY: driveFanOutPlans types results as unknown; every child plan matches T and E at this site.
  return unsafeCoerce(results);
}

export async function driveAllSettledPlans<T, E>(
  plans: readonly Plan<T, E, unknown>[],
  outerContext: RunContext<readonly unknown[]>,
  concurrency: number | undefined,
): Promise<Result<Result<T, E | UnhandledException>[], UnhandledException>> {
  const limit = concurrencyLimit(concurrency, plans.length);

  if (limit.isErr()) return limit;

  if (plans.length === 0) return Result.ok([]);

  if (limit.value >= plans.length) {
    const results = await driveAllSettledUnboundedPlans(plans, outerContext);
    return Result.ok(results);
  }

  const results = await driveFanOutPlans(plans, outerContext, {
    poolSize: limit.value,
    executeChild: executeCooperativePlan,
    shouldScheduleMore: () => true,
  });

  return collectAllSettled(results);
}

export async function driveRacePlans<T, E>(
  plans: readonly Plan<T, E, unknown>[],
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, E | UnhandledException>> {
  if (plans.length === 0) {
    const cause = new Error("Op.race requires at least one operation");
    return Promise.resolve(Result.err(new UnhandledException({ cause })));
  }

  let winnerClaimed = false;
  let winner: Result<T, E | UnhandledException> | undefined;
  await driveFanOutPlans(plans, outerContext, {
    poolSize: plans.length,
    executeChild: executeInterruptingPlan,
    shouldScheduleMore: () => true,
    onChildSettled: (result, index, { abortSiblingsExcept }) => {
      if (!winnerClaimed) {
        winnerClaimed = true;
        winner = result;
        abortSiblingsExcept(index);
      }
    },
  });

  if (winner !== undefined) return winner;

  const cause = new Error("Op.race failed to produce a winner");
  return Result.err(new UnhandledException({ cause }));
}

export async function driveAnyPlans<T, E>(
  plans: readonly Plan<T, E, unknown>[],
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T, ErrorGroup<E | UnhandledException>>> {
  if (plans.length === 0) {
    return Promise.resolve(
      Result.err(new ErrorGroup([], "Op.any requires at least one operation")),
    );
  }

  let winnerClaimed = false;
  let winner: { value: T } | undefined;
  const results = await driveFanOutPlans(plans, outerContext, {
    poolSize: plans.length,
    executeChild: executeInterruptingPlan,
    shouldScheduleMore: () => true,
    onChildSettled: (result, index, { abortSiblingsExcept }) => {
      if (!winnerClaimed && result.isOk()) {
        winnerClaimed = true;
        winner = { value: result.value };
        abortSiblingsExcept(index);
      }
    },
  });

  if (winner !== undefined) return Result.ok(winner.value);

  const errors = results.flatMap((result) =>
    result !== undefined && Result.isError(result) ? [result.error] : [],
  );
  return Result.err(new ErrorGroup(errors, "Op.any failed because all operations failed"));
}
