import { Op } from "@prodkit/op";
import { assertProfileOpFactory } from "./harness.ts";
import { runAsyncChain, runOpYieldChain } from "./scenarios.ts";

export const CONCURRENCY_CHILDREN = 8;
export const RETRY_ATTEMPTS = 3;
export const TIMEOUT_BUDGET_MS = 250;

export type ComparisonScenarioKey =
  | "singleValue"
  | "all"
  | "any"
  | "race"
  | "retry"
  | "timeout"
  | "compose";

/** Column ids for the public comparison table. Add competitors here later. */
export type ImplementationId = "native" | "op";

export type ImplementationColumn = {
  id: ImplementationId;
  header: string;
  description: string;
};

export const IMPLEMENTATION_COLUMNS: readonly ImplementationColumn[] = [
  {
    id: "native",
    header: "Native baseline",
    description: "Raw Promise / hand-rolled equivalent on the same machine",
  },
  {
    id: "op",
    header: "@prodkit/op",
    description: "Workspace `@prodkit/op` build under test",
  },
];

export type ComparisonScenario = {
  key: ComparisonScenarioKey;
  label: string;
  group: ComparisonScenarioKey;
  nativeBench: string;
  opBench: string;
  overheadBench: string;
  nativeDescription: string;
  opDescription: string;
  native: () => Promise<void> | void;
  op: () => Promise<void> | void;
};

const op = assertProfileOpFactory(Op);

async function handRolledFirstSettler(childCount: number): Promise<void> {
  let winner: number | undefined;
  const controllers = Array.from({ length: childCount }, () => new AbortController());
  await Promise.all(
    Array.from({ length: childCount }, (_, index) =>
      Promise.resolve(index).then((value) => {
        if (winner === undefined) {
          winner = value;
          controllers.forEach((controller, controllerIndex) => {
            if (controllerIndex !== index) controller.abort();
          });
        }
        return value;
      }),
    ),
  );
  if (winner === undefined) {
    throw new Error("handRolledFirstSettler exhausted unexpectedly.");
  }
}

/** Primary comparison rows shown in PERFORMANCE.md and CodSpeed overhead tracking. */
export const COMPARISON_SCENARIOS: readonly ComparisonScenario[] = [
  {
    key: "singleValue",
    label: "Single value",
    group: "singleValue",
    nativeBench: "singleValue.rawAsync",
    opBench: "singleValue.opRun",
    overheadBench: "overhead.singleValue.ratio",
    nativeDescription: "`Promise.resolve(x)`",
    opDescription: "`Op.of(x).run()`",
    native: async () => {
      await Promise.resolve(69);
    },
    op: async () => {
      const result = await Op.of(69).run();
      if (!result.isOk()) throw new Error("singleValue.opRun failed unexpectedly.");
    },
  },
  {
    key: "all",
    label: "Parallel batch (8 children)",
    group: "all",
    nativeBench: "all.promiseAll",
    opBench: "all.opAll",
    overheadBench: "overhead.all.ratio",
    nativeDescription: "`Promise.all([...])`",
    opDescription: "`Op.all([...]).run()`",
    native: async () => {
      await Promise.all(
        Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Promise.resolve(index)),
      );
    },
    op: async () => {
      const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
      const result = await Op.all(ops).run();
      if (!result.isOk()) throw new Error("all.opAll failed unexpectedly.");
    },
  },
  {
    key: "any",
    label: "First success (8 children)",
    group: "any",
    nativeBench: "any.handRolledFirstSuccess",
    opBench: "any.opAny",
    overheadBench: "overhead.any.ratio",
    nativeDescription: "Hand-rolled first success + abort",
    opDescription: "`Op.any([...]).run()`",
    native: async () => {
      await handRolledFirstSettler(CONCURRENCY_CHILDREN);
    },
    op: async () => {
      const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
      const result = await Op.any(ops).run();
      if (!result.isOk()) throw new Error("any.opAny failed unexpectedly.");
    },
  },
  {
    key: "race",
    label: "First settler (8 children)",
    group: "race",
    nativeBench: "race.handRolledFirstSettler",
    opBench: "race.opRace",
    overheadBench: "overhead.race.ratio",
    nativeDescription: "Hand-rolled first settler + abort",
    opDescription: "`Op.race([...]).run()`",
    native: async () => {
      await handRolledFirstSettler(CONCURRENCY_CHILDREN);
    },
    op: async () => {
      const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
      const result = await Op.race(ops).run();
      if (!result.isOk()) throw new Error("race.opRace failed unexpectedly.");
    },
  },
  {
    key: "retry",
    label: "Retry loop",
    group: "retry",
    nativeBench: "retry.handRolled",
    opBench: "retry.opWithRetry",
    overheadBench: "overhead.retry.ratio",
    nativeDescription: "Hand-rolled try/catch retry",
    opDescription: "`Op.try(...).withRetry(...).run()`",
    native: async () => {
      let attempt = 0;
      for (;;) {
        attempt += 1;
        try {
          if (attempt < RETRY_ATTEMPTS) throw new Error("retry");
          break;
        } catch {
          if (attempt >= RETRY_ATTEMPTS)
            throw new Error("retry.handRolled exhausted unexpectedly.");
        }
      }
    },
    op: async () => {
      let attempt = 0;
      const result = await Op.try(() => {
        attempt += 1;
        if (attempt < RETRY_ATTEMPTS) throw new Error("retry");
        return 1;
      })
        .withRetry({
          maxAttempts: RETRY_ATTEMPTS,
          shouldRetry: () => true,
          getDelay: () => 0,
        })
        .run();
      if (!result.isOk()) throw new Error("retry.opWithRetry failed unexpectedly.");
    },
  },
  {
    key: "timeout",
    label: "Timeout guard",
    group: "timeout",
    nativeBench: "timeout.promiseRace",
    opBench: "timeout.opWithTimeout",
    overheadBench: "overhead.timeout.ratio",
    nativeDescription: "`Promise.race` + `setTimeout`",
    opDescription: "`Op.of(x).withTimeout(ms).run()`",
    native: async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timer = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          reject(new Error("timeout should not fire"));
        }, TIMEOUT_BUDGET_MS);
      });
      await Promise.race([Promise.resolve(7), timer]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    },
    op: async () => {
      const result = await Op.of(7).withTimeout(TIMEOUT_BUDGET_MS).run();
      if (!result.isOk()) throw new Error("timeout.opWithTimeout failed unexpectedly.");
    },
  },
  {
    key: "compose",
    label: "Sequential compose (6 steps)",
    group: "compose",
    nativeBench: "compose.asyncSteps",
    opBench: "compose.opYieldChain",
    overheadBench: "overhead.compose.ratio",
    nativeDescription: "`await Promise.resolve` chain",
    opDescription: "`yield* Op.of` generator chain",
    native: async () => {
      await runAsyncChain();
    },
    op: async () => {
      await runOpYieldChain(op);
    },
  },
];

export function slowdownRatio(referenceHz: number, variantHz: number): number {
  if (variantHz === 0) return 0;
  return referenceHz / variantHz;
}

export type ComparisonOutcome = {
  winner: ImplementationId;
  /** Factor by which the winner beat the loser (always >= 1). */
  margin: number;
};

export function comparisonOutcome(nativeHz: number, opHz: number): ComparisonOutcome {
  if (nativeHz >= opHz) {
    return { winner: "native", margin: slowdownRatio(nativeHz, opHz) };
  }
  return { winner: "op", margin: slowdownRatio(opHz, nativeHz) };
}

const RATIO_SAMPLE_COUNT = 5;

/** Measure op/native wall time in one bench iteration; scales follow-up work with the ratio. */
export async function runOverheadRatioBench(
  native: () => Promise<void> | void,
  opWork: () => Promise<void> | void,
): Promise<void> {
  let nativeMs = 0;
  let opMs = 0;
  for (let sample = 0; sample < RATIO_SAMPLE_COUNT; sample += 1) {
    const nativeStart = performance.now();
    await native();
    nativeMs += performance.now() - nativeStart;

    const opStart = performance.now();
    await opWork();
    opMs += performance.now() - opStart;
  }

  const ratio = opMs / Math.max(nativeMs, Number.EPSILON);
  const repeat = Math.max(1, Math.round(ratio));
  for (let index = 0; index < repeat; index += 1) {
    await opWork();
  }
}
