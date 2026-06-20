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
  const runningByIndex: Array<{ abort(): void } | undefined> = Array(plans.length);

  const abortSiblingsExcept = (keepIndex: number) => {
    for (let index = 0; index < runningByIndex.length; index += 1) {
      if (index === keepIndex) continue;
      const child = runningByIndex[index];
      if (child !== undefined) child.abort();
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
    runningByIndex[index] = undefined;
    slot.release();
    results[index] = res;
    config.onChildSettled?.(res, index, controls);
  };

  try {
    if (config.poolSize >= plans.length) {
      const runs = plans.map((plan, index) => {
        const child = children.spawn();
        runningByIndex[index] = child;
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
        runningByIndex[i] = child;
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

function missingResultError(index: number): UnhandledException {
  return new UnhandledException({
    cause: new Error(`Op combinator invariant violation: missing result at index ${index}`),
  });
}

export function collectAllOk<T, E>(
  results: readonly (Result<T, E | UnhandledException> | undefined)[],
): Result<T[], E | UnhandledException> {
  const values: T[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result === undefined) return Result.err(missingResultError(index));
    if (result.isErr()) return result;
    values.push(result.value);
  }

  return Result.ok(values);
}

const executeInterruptingPlan: ExecuteChildPlan = (plan, context) =>
  Settlement.interrupting.runPlan(plan, context);

async function driveAllUntilFirstError<T, E>(
  plans: readonly Plan<T, E, unknown>[],
  outerContext: RunContext<readonly unknown[]>,
  config: {
    poolSize: number;
    onFirstError: (controls: FanOutSettleControls, index: number) => void;
  },
): Promise<Result<T[], E | UnhandledException>> {
  let firstErr: Err<T, E | UnhandledException> | undefined;
  const results = await driveFanOutPlans(plans, outerContext, {
    poolSize: config.poolSize,
    executeChild: executeInterruptingPlan,
    shouldScheduleMore: () => firstErr === undefined,
    onChildSettled: (result, index, controls) => {
      if (result.isErr() && firstErr === undefined) {
        firstErr = result;
        config.onFirstError(controls, index);
      }
    },
  });

  if (firstErr !== undefined) return firstErr;

  return collectAllOk(results);
}

async function driveAllUnboundedPlans<T, E>(
  plans: readonly Plan<T, E, unknown>[],
  outerContext: RunContext<readonly unknown[]>,
): Promise<Result<T[], E | UnhandledException>> {
  return driveAllUntilFirstError(plans, outerContext, {
    poolSize: plans.length,
    onFirstError: ({ abortSiblingsExcept }, index) => abortSiblingsExcept(index),
  });
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

  return driveAllUntilFirstError(plans, outerContext, {
    poolSize: limit.value,
    onFirstError: ({ abortActive }) => abortActive(),
  });
}

export const executeCooperativePlan: ExecuteChildPlan = (plan, context) =>
  Settlement.cooperative.runPlan(plan, context);

export function collectAllSettled<T, E>(
  results: ReadonlyArray<Result<T, E | UnhandledException> | undefined>,
): Result<Result<T, E | UnhandledException>[], UnhandledException> {
  const settled: Result<T, E | UnhandledException>[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result === undefined) return Result.err(missingResultError(index));
    settled.push(result);
  }

  return Result.ok(settled);
}

export async function driveAllSettledPlans<T, E>(
  plans: readonly Plan<T, E, unknown>[],
  outerContext: RunContext<readonly unknown[]>,
  concurrency: number | undefined,
): Promise<Result<Result<T, E | UnhandledException>[], UnhandledException>> {
  const limit = concurrencyLimit(concurrency, plans.length);

  if (limit.isErr()) return limit;

  if (plans.length === 0) return Result.ok([]);

  const results = await driveFanOutPlans(plans, outerContext, {
    poolSize: limit.value >= plans.length ? plans.length : limit.value,
    executeChild: executeCooperativePlan,
    shouldScheduleMore: () => true,
  });

  if (limit.value >= plans.length) {
    // SAFETY: driveFanOutPlans types results as unknown; every child plan matches T and E at this site.
    const settled: Result<T, E | UnhandledException>[] = unsafeCoerce(results);
    return Result.ok(settled);
  }

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

  const errors: Array<E | UnhandledException> = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result !== undefined && Result.isError(result)) errors.push(result.error);
  }
  return Result.err(new ErrorGroup(errors, "Op.any failed because all operations failed"));
}
