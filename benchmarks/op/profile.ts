import { statSync } from "node:fs";
import path from "node:path";
import {
  asBenchOp,
  BENCHMARK_ARTIFACTS_DIR,
  ensureBenchmarkArtifactsDir,
  findNewestProfileArtifact,
  formatNumber,
  formatRatio,
  getRepoRoot,
  importOpModule,
  parseArgValue,
  parsePositiveInt,
  parseReportPath,
  parseStepsArg,
  readEnvironmentReport,
  readPackageVersion,
  resolveBenchmarkArtifact,
  resolveOpPackageDir,
  runTinybenchVariant,
  writeJsonReport,
  type TinybenchRecord,
} from "./harness.ts";
import type { BenchOp } from "./scenarios.ts";
import {
  runAsyncChain,
  runAsyncFnChain,
  runOpFlatLoop,
  runOpSequentialRuns,
  runOpYieldChain,
  runRawSyncYieldStarChain,
  runSingleOpRun,
} from "./scenarios.ts";
import { unsafeCoerce } from "@prodkit/shared/runtime";

type AsyncScenarioName =
  | "baseline.asyncChain"
  | "baseline.asyncFnChain"
  | "compose.yieldChain"
  | "compose.flatOp"
  | "compose.sequentialRuns"
  | "compose.singleValueRun";

type SyncReferenceScenarioName = "generator.rawYieldStarSync";

type ProfileMode = "breakdown" | "cpu" | "heap";

type AsyncScenarioSpec = {
  kind: "async";
  name: AsyncScenarioName;
  description: string;
  run: (Op: BenchOp, steps: number) => Promise<unknown>;
};

type SyncScenarioSpec = {
  kind: "sync";
  name: SyncReferenceScenarioName;
  description: string;
  run: (steps: number) => unknown;
};

type ScenarioSpec = AsyncScenarioSpec | SyncScenarioSpec;

type ScenarioRecord = TinybenchRecord & {
  description: string;
  ratioToBaseline: number | null;
};

type ProfileReport = {
  generatedAt: string;
  environment: ReturnType<typeof readEnvironmentReport>;
  target: {
    packageDir: string;
    packageVersion: string;
  };
  steps: number;
  asyncScenarios: Record<AsyncScenarioName, ScenarioRecord>;
  syncReference: Record<
    SyncReferenceScenarioName,
    TinybenchRecord & {
      description: string;
      note: string;
    }
  >;
};

const ASYNC_SCENARIOS: AsyncScenarioSpec[] = [
  {
    kind: "async",
    name: "baseline.asyncChain",
    description: "await Promise.resolve chain (native baseline)",
    run: (_Op, steps) => runAsyncChain(steps),
  },
  {
    kind: "async",
    name: "baseline.asyncFnChain",
    description: "await sync values through async fn (microtask-only model)",
    run: (_Op, steps) => runAsyncFnChain(steps),
  },
  {
    kind: "async",
    name: "compose.yieldChain",
    description: "yield* Op.of per step (full sequential compose path)",
    run: (Op, steps) => runOpYieldChain(Op, steps),
  },
  {
    kind: "async",
    name: "compose.flatOp",
    description: "single Op with inline loop (one driver pass, no nested yield*)",
    run: (Op, steps) => runOpFlatLoop(Op, steps),
  },
  {
    kind: "async",
    name: "compose.sequentialRuns",
    description: "sequential Op.of(...).run() (per-step shell, no yield* delegation)",
    run: (Op, steps) => runOpSequentialRuns(Op, steps),
  },
  {
    kind: "async",
    name: "compose.singleValueRun",
    description: "single Op.of(x).run()",
    run: (Op) => runSingleOpRun(Op),
  },
];

const SYNC_REFERENCE_SCENARIOS: SyncScenarioSpec[] = [
  {
    kind: "sync",
    name: "generator.rawYieldStarSync",
    description: "raw sync yield* chain (no Op, no async driver)",
    run: (steps) => runRawSyncYieldStarChain(steps),
  },
];

const ALL_SCENARIO_NAMES = [
  ...ASYNC_SCENARIOS.map((scenario) => scenario.name),
  ...SYNC_REFERENCE_SCENARIOS.map((scenario) => scenario.name),
] as const;

const DEFAULT_PROFILE_CPU_ITERATIONS = 2_000_000;
const DEFAULT_PROFILE_HEAP_ITERATIONS = 500_000;

const logger = console;

function parseProfileMode(argv: readonly string[]): ProfileMode {
  const value = parseArgValue(argv, "--profile-mode=");
  if (value === undefined) return "breakdown";
  if (value === "breakdown" || value === "cpu" || value === "heap") return value;
  throw new Error(`Invalid profile mode "${value}". Expected breakdown, cpu, or heap.`);
}

function parseScenarioFilter(argv: readonly string[]): string | undefined {
  const value = parseArgValue(argv, "--scenario=");
  if (value === undefined) return undefined;
  const allScenarioNames: readonly string[] = unsafeCoerce(ALL_SCENARIO_NAMES);
  if (!allScenarioNames.includes(value)) {
    throw new Error(
      `Invalid scenario "${value}". Expected one of: ${ALL_SCENARIO_NAMES.join(", ")}`,
    );
  }
  return value;
}

function selectScenarios(filter: string | undefined): ScenarioSpec[] {
  const all = [...ASYNC_SCENARIOS, ...SYNC_REFERENCE_SCENARIOS];
  if (filter === undefined) return all;
  return all.filter((scenario) => scenario.name === filter);
}

function printAsyncBreakdownTable(
  rows: Array<ScenarioRecord & { name: AsyncScenarioName }>,
  steps: number,
): void {
  logger.info("");
  logger.info(
    `Async profile breakdown (${steps} compose steps where applicable; higher ops/sec is better):`,
  );
  logger.info("");
  logger.info(
    `${"Scenario".padEnd(28)} ${"ops/sec".padStart(14)} ${"mean ms".padStart(10)} ${"sem ms".padStart(10)} ${"rme %".padStart(8)} ${"vs asyncChain".padStart(14)}  Description`,
  );
  logger.info(
    `${"-".repeat(28)} ${"-".repeat(14)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(8)} ${"-".repeat(14)}  ${"-".repeat(40)}`,
  );
  for (const row of rows) {
    const ratio =
      row.ratioToBaseline === null
        ? "n/a".padStart(14)
        : formatRatio(row.ratioToBaseline).padStart(14);
    logger.info(
      `${row.name.padEnd(28)} ${formatNumber(row.hz).padStart(14)} ${formatNumber(row.latencyMs).padStart(10)} ${formatNumber(row.semMs).padStart(10)} ${formatNumber(row.rme).padStart(8)} ${ratio}  ${row.description}`,
    );
  }
}

function printSyncReferenceTable(
  rows: Array<
    TinybenchRecord & {
      name: SyncReferenceScenarioName;
      description: string;
      note: string;
    }
  >,
): void {
  logger.info("");
  logger.info("Sync reference (not included in async baseline ratios):");
  logger.info("");
  logger.info(
    `${"Scenario".padEnd(28)} ${"ops/sec".padStart(14)} ${"mean ms".padStart(10)} ${"sem ms".padStart(10)} ${"rme %".padStart(8)}  Description`,
  );
  logger.info(
    `${"-".repeat(28)} ${"-".repeat(14)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(8)}  ${"-".repeat(40)}`,
  );
  for (const row of rows) {
    logger.info(
      `${row.name.padEnd(28)} ${formatNumber(row.hz).padStart(14)} ${formatNumber(row.latencyMs).padStart(10)} ${formatNumber(row.semMs).padStart(10)} ${formatNumber(row.rme).padStart(8)}  ${row.description}`,
    );
    logger.info(`  note: ${row.note}`);
  }
}

function printInterpretationGuide(): void {
  logger.info("");
  logger.info("How to read these scenarios:");
  logger.info(
    "- baseline.asyncChain vs baseline.asyncFnChain: separates Promise.resolve overhead from async-fn microtask overhead.",
  );
  logger.info(
    "- compose.flatOp vs compose.yieldChain: separates single-driver cost from nested yield* composition.",
  );
  logger.info(
    "- compose.sequentialRuns vs compose.yieldChain: separates per-step Op shell allocation from yield* delegation.",
  );
  logger.info(
    "- generator.rawYieldStarSync: sync-only reference; compare absolute ops/sec, not baseline ratios.",
  );
  logger.info("");
  logger.info("Machine-readable output:");
  logger.info(
    `  pnpm --filter @prodkit/benchmarks run profile -- --report=${resolveBenchmarkArtifact("profile.json")}`,
  );
  logger.info("");
  logger.info("CPU profile (flame graph):");
  logger.info(
    "  pnpm --filter @prodkit/benchmarks run profile:cpu -- --scenario=compose.yieldChain",
  );
  logger.info(
    "  Open the emitted *.cpuprofile in op/.artifacts/ via Chrome DevTools or https://speedscope.app",
  );
  logger.info("");
  logger.info("Heap profile (allocations):");
  logger.info(
    "  pnpm --filter @prodkit/benchmarks run profile:heap -- --scenario=compose.yieldChain",
  );
  logger.info("  Open the emitted *.heapprofile in op/.artifacts/ via Chrome DevTools Memory");
}

async function measureAsyncScenario(
  spec: AsyncScenarioSpec,
  Op: BenchOp,
  steps: number,
): Promise<ScenarioRecord> {
  const record = await runTinybenchVariant(spec.name, () => spec.run(Op, steps));
  return {
    ...record,
    description: spec.description,
    ratioToBaseline: null,
  };
}

async function measureSyncScenario(
  spec: SyncScenarioSpec,
  steps: number,
): Promise<TinybenchRecord & { description: string; note: string }> {
  const record = await runTinybenchVariant(spec.name, () => spec.run(steps));
  return {
    ...record,
    description: spec.description,
    note: "Sync-only reference scenario; excluded from async baseline ratios.",
  };
}

async function runProfileLoop(
  spec: ScenarioSpec,
  Op: BenchOp,
  steps: number,
  iterations: number,
): Promise<void> {
  logger.info(`Profiling ${spec.name} (${iterations.toLocaleString("en-US")} iterations)...`);
  for (let index = 0; index < iterations; index += 1) {
    if (spec.kind === "async") {
      await spec.run(Op, steps);
    } else {
      spec.run(steps);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const repoRoot = getRepoRoot();
  const packageDir = resolveOpPackageDir(repoRoot, parseArgValue(argv, "--package-dir="));
  const profileMode = parseProfileMode(argv);
  const scenarioFilter = parseScenarioFilter(argv);
  const steps = parseStepsArg(argv);
  const reportPath = parseReportPath(argv);
  const profileLoopIterations =
    profileMode === "breakdown"
      ? undefined
      : parsePositiveInt(
          parseArgValue(argv, "--iterations=") ??
            String(
              profileMode === "cpu"
                ? DEFAULT_PROFILE_CPU_ITERATIONS
                : DEFAULT_PROFILE_HEAP_ITERATIONS,
            ),
          "iterations",
        );

  const { Op: opModule } = await importOpModule(packageDir);
  const Op = asBenchOp(opModule);
  const packageVersion = await readPackageVersion(packageDir);
  const selected = selectScenarios(scenarioFilter);

  logger.info(
    `Profile environment: node=${process.version} platform=${process.platform} arch=${process.arch}`,
  );
  logger.info(`Profile target: ${packageDir} (@prodkit/op@${packageVersion})`);
  logger.info(`Profile mode: ${profileMode}`);
  logger.info(`Compose steps: ${steps}`);

  if (profileMode === "cpu" || profileMode === "heap") {
    if (selected.length !== 1) {
      throw new Error(
        `${profileMode} mode requires exactly one --scenario=... (got ${selected.length}).`,
      );
    }
    const spec = selected[0];
    if (!spec) {
      throw new Error("No scenario selected.");
    }
    if (profileLoopIterations === undefined) {
      throw new Error(`${profileMode} mode requires profile loop iterations.`);
    }

    await ensureBenchmarkArtifactsDir();
    const artifactsDir = path.resolve(BENCHMARK_ARTIFACTS_DIR);
    const startedAt = Date.now();
    await runProfileLoop(spec, Op, steps, profileLoopIterations);
    const artifactPrefix = profileMode === "cpu" ? "CPU" : "Heap";
    const artifactPath = findNewestProfileArtifact(artifactsDir, artifactPrefix);
    logger.info("");
    if (artifactPath !== undefined && statArtifactIsFresh(artifactPath, startedAt)) {
      logger.info(`${artifactPrefix} profile written: ${artifactPath}`);
    } else {
      logger.info(
        `${artifactPrefix} profile should be written in ${artifactsDir} as ${artifactPrefix}.*`,
      );
    }
    return;
  }

  const asyncSelected = selected.filter(
    (scenario): scenario is AsyncScenarioSpec => scenario.kind === "async",
  );
  const syncSelected = selected.filter(
    (scenario): scenario is SyncScenarioSpec => scenario.kind === "sync",
  );

  const asyncRows: Array<ScenarioRecord & { name: AsyncScenarioName }> = [];
  for (const spec of asyncSelected) {
    const record = await measureAsyncScenario(spec, Op, steps);
    asyncRows.push({ name: spec.name, ...record });
  }

  const baseline = asyncRows.find((row) => row.name === "baseline.asyncChain");
  if (baseline !== undefined && baseline.hz > 0) {
    for (const row of asyncRows) {
      row.ratioToBaseline = baseline.hz / row.hz;
    }
  }

  const syncRows: Array<
    TinybenchRecord & {
      name: SyncReferenceScenarioName;
      description: string;
      note: string;
    }
  > = [];
  for (const spec of syncSelected) {
    const record = await measureSyncScenario(spec, steps);
    syncRows.push({ name: spec.name, ...record });
  }

  printAsyncBreakdownTable(asyncRows, steps);
  if (syncRows.length > 0) {
    printSyncReferenceTable(syncRows);
  }
  printInterpretationGuide();

  if (reportPath !== undefined) {
    const asyncScenarios: ProfileReport["asyncScenarios"] = Object.create(null);
    for (const row of asyncRows) {
      asyncScenarios[row.name] = {
        hz: row.hz,
        latencyMs: row.latencyMs,
        latencyMinMs: row.latencyMinMs,
        latencyMaxMs: row.latencyMaxMs,
        semMs: row.semMs,
        rme: row.rme,
        sampleCount: row.sampleCount,
        description: row.description,
        ratioToBaseline: row.ratioToBaseline,
      };
    }

    const syncReference: ProfileReport["syncReference"] = Object.create(null);
    for (const row of syncRows) {
      syncReference[row.name] = {
        hz: row.hz,
        latencyMs: row.latencyMs,
        latencyMinMs: row.latencyMinMs,
        latencyMaxMs: row.latencyMaxMs,
        semMs: row.semMs,
        rme: row.rme,
        sampleCount: row.sampleCount,
        description: row.description,
        note: row.note,
      };
    }

    const report: ProfileReport = {
      generatedAt: new Date().toISOString(),
      environment: readEnvironmentReport(),
      target: {
        packageDir,
        packageVersion,
      },
      steps,
      asyncScenarios,
      syncReference,
    };
    await writeJsonReport(reportPath, report);
    logger.info(`Wrote profile report: ${path.resolve(reportPath)}`);
  }
}

function statArtifactIsFresh(artifactPath: string, startedAtMs: number): boolean {
  try {
    return statSync(artifactPath).mtimeMs >= startedAtMs - 1_000;
  } catch {
    return false;
  }
}

main().catch((error) => {
  logger.error(error);
  process.exitCode = 1;
});
