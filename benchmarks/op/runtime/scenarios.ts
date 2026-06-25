import { unsafeCoerce } from "@prodkit/shared/runtime";

export const COMPOSE_STEPS = 6;
export const CONCURRENCY_CHILDREN = 8;
export const RETRY_ATTEMPTS = 3;
export const TIMEOUT_BUDGET_MS = 250;

export type RunResult = { isOk: () => boolean; value?: unknown };

/** Callable Op surface imported from the package under test. */
export type BenchOp = {
  (generator: () => Generator<unknown, unknown, unknown>): { run: () => Promise<RunResult> };
  of: (value: unknown) => { run: () => Promise<RunResult> };
};

/** Native baseline: await Promise.resolve chain. */
export async function runAsyncChain(steps: number = COMPOSE_STEPS): Promise<number> {
  let value = await Promise.resolve(1);
  for (let step = 0; step < steps; step += 1) {
    value = await Promise.resolve(value + 1);
  }
  if (value !== steps + 1) {
    throw new Error("runAsyncChain failed unexpectedly.");
  }
  return value;
}

/**
 * Models driveIterator's async boundary: each step awaits a sync value through an async function.
 * Isolates microtask cost from generator and Op allocation.
 */
export async function runAsyncFnChain(steps: number = COMPOSE_STEPS): Promise<number> {
  let value = 1;
  for (let step = 0; step < steps; step += 1) {
    value = await (async () => value + 1)();
  }
  if (value !== steps + 1) {
    throw new Error("runAsyncFnChain failed unexpectedly.");
  }
  return value;
}

/** Full sequential compose path: yield* Op.of per step. */
export async function runOpYieldChain(Op: BenchOp, steps: number = COMPOSE_STEPS): Promise<number> {
  const program = Op(function* () {
    let value = 1;
    for (let step = 0; step < steps; step += 1) {
      value = yield* unsafeCoerce(Op.of(value + 1));
    }
    return value;
  });
  const result = await program.run();
  if (!result.isOk() || result.value !== steps + 1) {
    throw new Error("runOpYieldChain failed unexpectedly.");
  }
  return result.value;
}

/** Single Op, inline loop (one genPlan / one driveIterator, no nested yield*). */
export async function runOpFlatLoop(Op: BenchOp, steps: number = COMPOSE_STEPS): Promise<number> {
  const program = Op(function* () {
    let value = 1;
    for (let step = 0; step < steps; step += 1) {
      value = value + 1;
    }
    return value;
  });
  const result = await program.run();
  if (!result.isOk() || result.value !== steps + 1) {
    throw new Error("runOpFlatLoop failed unexpectedly.");
  }
  return result.value;
}

/** Sequential Op.of(...).run() calls (per-step Op shell, no yield* delegation). */
export async function runOpSequentialRuns(
  Op: BenchOp,
  steps: number = COMPOSE_STEPS,
): Promise<number> {
  let value = 1;
  for (let step = 0; step < steps; step += 1) {
    const result = await Op.of(value + 1).run();
    if (!result.isOk()) {
      throw new Error("runOpSequentialRuns failed unexpectedly.");
    }
    value = unsafeCoerce(result.value);
  }
  if (value !== steps + 1) {
    throw new Error("runOpSequentialRuns failed unexpectedly.");
  }
  return value;
}

/** Single Op.of(x).run(). */
export async function runSingleOpRun(Op: BenchOp): Promise<void> {
  const result = await Op.of(69).run();
  if (!result.isOk()) {
    throw new Error("runSingleOpRun failed unexpectedly.");
  }
}

/**
 * Raw sync yield* chain: completes inside one outer .next() per loop body.
 * Shows native generator delegation cost without Op or async driver.
 */
export function runRawSyncYieldStarChain(steps: number = COMPOSE_STEPS): number {
  function* leaf(value: number): Generator<never, number, unknown> {
    return value;
  }
  function* program(): Generator<Generator<never, number, unknown>, number, unknown> {
    let value = 1;
    for (let step = 0; step < steps; step += 1) {
      value = yield* leaf(value + 1);
    }
    return value;
  }

  const iterator = program();
  let step = iterator.next();
  while (!step.done) {
    step = iterator.next();
  }
  if (step.value !== steps + 1) {
    throw new Error("runRawSyncYieldStarChain failed unexpectedly.");
  }
  return step.value;
}
