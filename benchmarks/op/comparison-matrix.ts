import {
  runEffectAll,
  runEffectFirstSuccess,
  runEffectRaceFirst,
  runEffectRetry,
  runEffectSingleValue,
  runEffectTimeout,
  runEffectYieldChain,
} from "./effect-scenarios.ts";
import { asBenchOp, isRecord } from "./harness.ts";
import {
  CONCURRENCY_CHILDREN,
  RETRY_ATTEMPTS,
  runAsyncChain,
  runOpYieldChain,
  TIMEOUT_BUDGET_MS,
  type RunResult,
} from "./scenarios.ts";
import { unsafeCoerce } from "@prodkit/shared/runtime";

export { CONCURRENCY_CHILDREN, RETRY_ATTEMPTS, TIMEOUT_BUDGET_MS } from "./scenarios.ts";

export const BASELINE_IMPLEMENTATION_ID = "native" as const;

export type ComparisonScenarioKey =
  | "singleValue"
  | "all"
  | "any"
  | "race"
  | "retry"
  | "timeout"
  | "compose";

/** Column ids for the public comparison table. */
export type ImplementationId = typeof BASELINE_IMPLEMENTATION_ID | "op" | "effect";

export type ImplementationColumn = {
  id: ImplementationId;
  header: string;
  description: string;
};

export const IMPLEMENTATION_COLUMNS: readonly ImplementationColumn[] = [
  {
    id: BASELINE_IMPLEMENTATION_ID,
    header: "Native baseline",
    description: "Raw Promise / hand-rolled equivalent on the same machine",
  },
  {
    id: "op",
    header: "@prodkit/op",
    description: "Workspace `@prodkit/op` build under test",
  },
  {
    id: "effect",
    header: "effect",
    description: "`effect` npm package on the same machine",
  },
];

export type ImplementationCell = {
  benchName: string;
  description: string;
  run: () => Promise<void> | void;
};

type Runnable = { run: () => Promise<RunResult> };
type ConfigurableRunnable = Runnable & { with: (policy: unknown) => Runnable };

export type ComparisonOp = {
  (generator: () => Generator<unknown, unknown, unknown>): Runnable;
  of: (value: unknown) => ConfigurableRunnable;
  all: (ops: readonly Runnable[]) => Runnable;
  any: (ops: readonly Runnable[]) => Runnable;
  race: (ops: readonly Runnable[]) => Runnable;
  try: (fn: () => unknown) => { with: (policy: unknown) => Runnable };
};

export type ComparisonPolicy = {
  retry: (options: { retries: number; when: () => boolean; delay: () => number }) => unknown;
  timeout: (ms: number) => unknown;
};

export type ComparisonRuntime = {
  Op: ComparisonOp;
  Policy: ComparisonPolicy;
};

export type ComparisonScenario = {
  key: ComparisonScenarioKey;
  label: string;
  group: ComparisonScenarioKey;
  overheadBench: string;
  implementations: Record<ImplementationId, ImplementationCell>;
};

function hasFunctionField(input: object, key: PropertyKey): boolean {
  return typeof Reflect.get(input, key) === "function";
}

export function asComparisonOp(input: unknown): ComparisonOp {
  asBenchOp(input);
  if (
    !isRecord(input) ||
    !hasFunctionField(input, "all") ||
    !hasFunctionField(input, "any") ||
    !hasFunctionField(input, "race") ||
    !hasFunctionField(input, "try")
  ) {
    throw new Error("Imported Op is missing required comparison methods.");
  }
  // SAFETY: The callable shape and required static methods are checked above.
  return unsafeCoerce(input);
}

export function asComparisonPolicy(input: unknown): ComparisonPolicy {
  if (
    !isRecord(input) ||
    !hasFunctionField(input, "retry") ||
    !hasFunctionField(input, "timeout")
  ) {
    throw new Error("Imported Policy is missing required comparison methods.");
  }
  // SAFETY: The policy namespace methods used by comparison scenarios are checked above.
  return unsafeCoerce(input);
}

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

function defineScenario(
  key: ComparisonScenarioKey,
  label: string,
  overheadBench: string,
  implementations: Record<ImplementationId, ImplementationCell>,
): ComparisonScenario {
  return { key, label, group: key, overheadBench, implementations };
}

/** Primary comparison rows shown in packages/op/docs/performance.md and CodSpeed overhead tracking. */
export function createComparisonScenarios(
  runtime: ComparisonRuntime,
): readonly ComparisonScenario[] {
  const { Op, Policy } = runtime;
  const op = asBenchOp(Op);
  return [
    defineScenario("singleValue", "Single value", "overhead.singleValue.ratio", {
      native: {
        benchName: "singleValue.rawAsync",
        description: "`Promise.resolve(x)`",
        run: async () => {
          await Promise.resolve(69);
        },
      },
      op: {
        benchName: "singleValue.opRun",
        description: "`Op.of(x).run()`",
        run: async () => {
          const result = await Op.of(69).run();
          if (!result.isOk()) throw new Error("singleValue.opRun failed unexpectedly.");
        },
      },
      effect: {
        benchName: "singleValue.effectRunPromise",
        description: "`Effect.runPromise(Effect.succeed(x))`",
        run: runEffectSingleValue,
      },
    }),
    defineScenario("all", "Parallel batch (8 children)", "overhead.all.ratio", {
      native: {
        benchName: "all.promiseAll",
        description: "`Promise.all([...])`",
        run: async () => {
          await Promise.all(
            Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Promise.resolve(index)),
          );
        },
      },
      op: {
        benchName: "all.opAll",
        description: "`Op.all([...]).run()`",
        run: async () => {
          const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
          const result = await Op.all(ops).run();
          if (!result.isOk()) throw new Error("all.opAll failed unexpectedly.");
        },
      },
      effect: {
        benchName: "all.effectAll",
        description: "`Effect.all(..., { concurrency: 'unbounded' })`",
        run: runEffectAll,
      },
    }),
    defineScenario("any", "First success (8 children)", "overhead.any.ratio", {
      native: {
        benchName: "any.handRolledFirstSuccess",
        description: "Hand-rolled first success + abort",
        run: async () => {
          await handRolledFirstSettler(CONCURRENCY_CHILDREN);
        },
      },
      op: {
        benchName: "any.opAny",
        description: "`Op.any([...]).run()`",
        run: async () => {
          const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
          const result = await Op.any(ops).run();
          if (!result.isOk()) throw new Error("any.opAny failed unexpectedly.");
        },
      },
      effect: {
        benchName: "any.effectFirstSuccessOf",
        description: "`Effect.firstSuccessOf([...])`",
        run: runEffectFirstSuccess,
      },
    }),
    defineScenario("race", "First settler (8 children)", "overhead.race.ratio", {
      native: {
        benchName: "race.handRolledFirstSettler",
        description: "Hand-rolled first settler + abort",
        run: async () => {
          await handRolledFirstSettler(CONCURRENCY_CHILDREN);
        },
      },
      op: {
        benchName: "race.opRace",
        description: "`Op.race([...]).run()`",
        run: async () => {
          const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
          const result = await Op.race(ops).run();
          if (!result.isOk()) throw new Error("race.opRace failed unexpectedly.");
        },
      },
      effect: {
        benchName: "race.effectRaceFirst",
        description: "`Effect.raceFirst` folded over children",
        run: runEffectRaceFirst,
      },
    }),
    defineScenario("retry", "Retry loop", "overhead.retry.ratio", {
      native: {
        benchName: "retry.handRolled",
        description: "Hand-rolled try/catch retry",
        run: async () => {
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
      },
      op: {
        benchName: "retry.opWithPolicyRetry",
        description: "`Op.try(...).with(Policy.retry(...)).run()`",
        run: async () => {
          let attempt = 0;
          const result = await Op.try(() => {
            attempt += 1;
            if (attempt < RETRY_ATTEMPTS) throw new Error("retry");
            return 1;
          })
            .with(
              Policy.retry({
                retries: RETRY_ATTEMPTS - 1,
                when: () => true,
                delay: () => 0,
              }),
            )
            .run();
          if (!result.isOk()) throw new Error("retry.opWithPolicyRetry failed unexpectedly.");
        },
      },
      effect: {
        benchName: "retry.effectRetry",
        description: "`Effect.retry(..., { times, schedule })`",
        run: runEffectRetry,
      },
    }),
    defineScenario("timeout", "Timeout guard", "overhead.timeout.ratio", {
      native: {
        benchName: "timeout.promiseRace",
        description: "`Promise.race` + `setTimeout`",
        run: async () => {
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
      },
      op: {
        benchName: "timeout.opWithPolicyTimeout",
        description: "`Op.of(x).with(Policy.timeout(ms)).run()`",
        run: async () => {
          const result = await Op.of(7).with(Policy.timeout(TIMEOUT_BUDGET_MS)).run();
          if (!result.isOk()) throw new Error("timeout.opWithPolicyTimeout failed unexpectedly.");
        },
      },
      effect: {
        benchName: "timeout.effectTimeout",
        description: "`Effect.timeout(ms)`",
        run: runEffectTimeout,
      },
    }),
    defineScenario("compose", "Sequential compose (6 steps)", "overhead.compose.ratio", {
      native: {
        benchName: "compose.asyncSteps",
        description: "`await Promise.resolve` chain",
        run: async () => {
          await runAsyncChain();
        },
      },
      op: {
        benchName: "compose.opYieldChain",
        description: "`yield* Op.of` generator chain",
        run: async () => {
          await runOpYieldChain(op);
        },
      },
      effect: {
        benchName: "compose.effectGenChain",
        description: "`Effect.gen` + `yield* Effect.succeed` chain",
        run: async () => {
          await runEffectYieldChain();
        },
      },
    }),
  ];
}

export function competitorColumns(): readonly ImplementationColumn[] {
  return IMPLEMENTATION_COLUMNS.filter((column) => column.id !== BASELINE_IMPLEMENTATION_ID);
}

export function baselineRatio(baselineHz: number, libHz: number): number {
  if (libHz === 0) return 0;
  return baselineHz / libHz;
}

export type VsBaselineRatios = Partial<Record<ImplementationId, number>>;

export function computeVsBaseline(
  runtime: Record<ImplementationId, { hz: number }>,
): VsBaselineRatios {
  const baselineHz = runtime[BASELINE_IMPLEMENTATION_ID].hz;
  const ratios: VsBaselineRatios = {};
  for (const column of competitorColumns()) {
    ratios[column.id] = baselineRatio(baselineHz, runtime[column.id].hz);
  }
  return ratios;
}

export type LibraryPairOutcome = {
  faster: ImplementationId;
  margin: number;
};

/** Compare two libraries directly from absolute ops/sec (margin is always >= 1). */
export function libraryPairOutcome(
  leftId: ImplementationId,
  leftHz: number,
  rightId: ImplementationId,
  rightHz: number,
): LibraryPairOutcome {
  if (leftHz >= rightHz) {
    return { faster: leftId, margin: baselineRatio(leftHz, rightHz) };
  }
  return { faster: rightId, margin: baselineRatio(rightHz, leftHz) };
}

const RATIO_SAMPLE_COUNT = 5;

/** Measure baseline/library wall time in one bench iteration; scales follow-up work with the ratio. */
export async function runOverheadRatioBench(
  baseline: () => Promise<void> | void,
  library: () => Promise<void> | void,
): Promise<void> {
  let baselineMs = 0;
  let libraryMs = 0;
  for (let sample = 0; sample < RATIO_SAMPLE_COUNT; sample += 1) {
    const baselineStart = performance.now();
    await baseline();
    baselineMs += performance.now() - baselineStart;

    const libraryStart = performance.now();
    await library();
    libraryMs += performance.now() - libraryStart;
  }

  const ratio = libraryMs / Math.max(baselineMs, Number.EPSILON);
  const repeat = Math.max(1, Math.round(ratio));
  for (let index = 0; index < repeat; index += 1) {
    await library();
  }
}
