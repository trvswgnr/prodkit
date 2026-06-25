import { statSync } from "node:fs";
import path from "node:path";
import {
  asComparisonOp,
  asComparisonPolicy,
  BASELINE_IMPLEMENTATION_ID,
  createComparisonScenarios,
  runOverheadRatioBench,
  type ComparisonRuntime,
} from "../runtime/comparison-matrix.ts";
import {
  asBenchOp,
  BENCHMARK_PROFILE_DIR,
  benchRunOptionSummary,
  ensureBenchmarkProfileDir,
  findNewestProfileArtifact,
  formatNumber,
  formatRatio,
  getRepoRoot,
  importOpModule,
  importOpPolicyModule,
  parseArgValue,
  parseBenchRunOptions,
  parsePositiveInt,
  parseReportPath,
  parseStepsArg,
  readEnvironmentReport,
  readPackageVersion,
  resolveBenchRunOptions,
  resolveProfileArtifact,
  resolveOpPackageDir,
  runTinybenchRepeatedVariant,
  writeJsonReport,
  type BenchRunOptions,
  type RepeatedTinybenchRecord,
  type ResolvedBenchRunOptions,
} from "../runtime/harness.ts";
import {
  createOfficialBenchmarkReportFields,
  createPackageMetadata,
  profileScenariosToOfficialResults,
  readBenchmarkCalibrationAttachment,
  readGitCommitMetadata,
  type OfficialBenchmarkReport,
  type ProfileScenarioOfficialInput,
} from "../reports/official-report.ts";
import type { BenchOp } from "../runtime/scenarios.ts";
import {
  runAsyncChain,
  runAsyncFnChain,
  runOpFlatLoop,
  runOpSequentialRuns,
  runOpYieldChain,
  runRawSyncYieldStarChain,
  runSingleOpRun,
} from "../runtime/scenarios.ts";

type ScenarioName = string;

type ProfileMode = "breakdown" | "cpu" | "heap";
type AsyncScenarioGroup = "compose" | "codspeed";
type ProfileIterationMode = Exclude<ProfileMode, "breakdown">;

type ProfileIterationDefaults = {
  cpu: number;
  heap: number;
};

type AsyncScenarioSpec = {
  kind: "async";
  group: AsyncScenarioGroup;
  name: ScenarioName;
  aliases?: readonly string[];
  description: string;
  run: (steps: number) => Promise<unknown>;
  profileIterations?: Partial<ProfileIterationDefaults>;
};

type SyncScenarioSpec = {
  kind: "sync";
  name: ScenarioName;
  aliases?: readonly string[];
  description: string;
  run: (steps: number) => unknown;
  profileIterations?: Partial<ProfileIterationDefaults>;
};

type ScenarioSpec = AsyncScenarioSpec | SyncScenarioSpec;

type ScenarioRecord = RepeatedTinybenchRecord & {
  description: string;
  group: AsyncScenarioGroup;
  aliases?: readonly string[];
  ratioToBaseline: number | null;
};

type ProfileReport = OfficialBenchmarkReport & {
  generatedAt: string;
  environment: ReturnType<typeof readEnvironmentReport>;
  target: {
    packageDir: string;
    packageVersion: string;
  };
  benchOptions: ResolvedBenchRunOptions;
  steps: number;
  asyncScenarios: Record<ScenarioName, ScenarioRecord>;
  syncReference: Record<
    ScenarioName,
    RepeatedTinybenchRecord & {
      description: string;
      aliases?: readonly string[];
      note: string;
    }
  >;
};

const DEFAULT_PROFILE_CPU_ITERATIONS = 2_000_000;
const DEFAULT_PROFILE_HEAP_ITERATIONS = 500_000;
const CODSPEED_PROFILE_CPU_ITERATIONS = 500_000;
const CODSPEED_PROFILE_HEAP_ITERATIONS = 100_000;
const OVERHEAD_PROFILE_CPU_ITERATIONS = 25_000;
const OVERHEAD_PROFILE_HEAP_ITERATIONS = 5_000;

const logger = console;

function createComposeProfileScenarios(Op: BenchOp): AsyncScenarioSpec[] {
  return [
    {
      kind: "async",
      group: "compose",
      name: "baseline.asyncChain",
      description: "await Promise.resolve chain (native baseline)",
      run: (steps) => runAsyncChain(steps),
    },
    {
      kind: "async",
      group: "compose",
      name: "baseline.asyncFnChain",
      description: "await sync values through async fn (microtask-only model)",
      run: (steps) => runAsyncFnChain(steps),
    },
    {
      kind: "async",
      group: "compose",
      name: "compose.yieldChain",
      description: "yield* Op.of per step (full sequential compose path)",
      run: (steps) => runOpYieldChain(Op, steps),
    },
    {
      kind: "async",
      group: "compose",
      name: "compose.flatOp",
      description: "single Op with inline loop (one driver pass, no nested yield*)",
      run: (steps) => runOpFlatLoop(Op, steps),
    },
    {
      kind: "async",
      group: "compose",
      name: "compose.sequentialRuns",
      description: "sequential Op.of(...).run() (per-step shell, no yield* delegation)",
      run: (steps) => runOpSequentialRuns(Op, steps),
    },
    {
      kind: "async",
      group: "compose",
      name: "compose.singleValueRun",
      description: "single Op.of(x).run()",
      run: () => runSingleOpRun(Op),
    },
  ];
}

function createCodSpeedProfileScenarios(runtime: ComparisonRuntime): AsyncScenarioSpec[] {
  const specs: AsyncScenarioSpec[] = [];
  const Op = asBenchOp(runtime.Op);
  for (const scenario of createComparisonScenarios(runtime)) {
    const opCell = scenario.implementations.op;
    specs.push({
      kind: "async",
      group: "codspeed",
      name: opCell.benchName,
      description: `CodSpeed Op scenario: ${scenario.label} (${opCell.description})`,
      run: async () => {
        await opCell.run();
      },
      profileIterations: {
        cpu: CODSPEED_PROFILE_CPU_ITERATIONS,
        heap: CODSPEED_PROFILE_HEAP_ITERATIONS,
      },
    });
    specs.push({
      kind: "async",
      group: "codspeed",
      name: scenario.overheadBench,
      description: `CodSpeed overhead ratio for ${scenario.label}`,
      run: () =>
        runOverheadRatioBench(scenario.implementations[BASELINE_IMPLEMENTATION_ID].run, opCell.run),
      profileIterations: {
        cpu: OVERHEAD_PROFILE_CPU_ITERATIONS,
        heap: OVERHEAD_PROFILE_HEAP_ITERATIONS,
      },
    });
  }
  specs.push(
    {
      kind: "async",
      group: "codspeed",
      name: "compose.opFlatLoop",
      description: "CodSpeed compose extra: single Op with inline loop",
      run: (steps) => runOpFlatLoop(Op, steps),
      profileIterations: {
        cpu: CODSPEED_PROFILE_CPU_ITERATIONS,
        heap: CODSPEED_PROFILE_HEAP_ITERATIONS,
      },
    },
    {
      kind: "async",
      group: "codspeed",
      name: "compose.opSequentialRuns",
      description: "CodSpeed compose extra: sequential Op.of(...).run()",
      run: (steps) => runOpSequentialRuns(Op, steps),
      profileIterations: {
        cpu: CODSPEED_PROFILE_CPU_ITERATIONS,
        heap: CODSPEED_PROFILE_HEAP_ITERATIONS,
      },
    },
  );
  return specs;
}

function createSyncReferenceScenarios(): SyncScenarioSpec[] {
  return [
    {
      kind: "sync",
      name: "compose.rawSyncYieldStar",
      aliases: ["generator.rawYieldStarSync"],
      description: "raw sync yield* chain (no Op, no async driver)",
      run: (steps) => runRawSyncYieldStarChain(steps),
    },
  ];
}

export function createProfileScenarios(Op: BenchOp, runtime: ComparisonRuntime): ScenarioSpec[] {
  return [
    ...createComposeProfileScenarios(Op),
    ...createCodSpeedProfileScenarios(runtime),
    ...createSyncReferenceScenarios(),
  ];
}

function parseProfileMode(argv: readonly string[]): ProfileMode {
  const value = parseArgValue(argv, "--profile-mode=");
  if (value === undefined) return "breakdown";
  if (value === "breakdown" || value === "cpu" || value === "heap") return value;
  throw new Error(`Invalid profile mode "${value}". Expected breakdown, cpu, or heap.`);
}

function scenarioNames(scenarios: readonly ScenarioSpec[]): string[] {
  return scenarios.flatMap((scenario) => [scenario.name, ...(scenario.aliases ?? [])]);
}

function scenarioMatchesFilter(scenario: ScenarioSpec, filter: string): boolean {
  return scenario.name === filter || (scenario.aliases ?? []).includes(filter);
}

function selectScenarios(
  scenarios: readonly ScenarioSpec[],
  filter: string | undefined,
): ScenarioSpec[] {
  if (filter === undefined) return [...scenarios];
  const selected = scenarios.filter((scenario) => scenarioMatchesFilter(scenario, filter));
  if (selected.length === 0) {
    throw new Error(
      `Invalid scenario "${filter}". Expected one of: ${scenarioNames(scenarios).join(", ")}`,
    );
  }
  return selected;
}

function formatMilliseconds(value: number): string {
  return Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);
}

function printAsyncBreakdownTable(
  rows: Array<ScenarioRecord & { name: ScenarioName }>,
  steps: number,
): void {
  if (rows.length === 0) return;
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
      `${row.name.padEnd(28)} ${formatNumber(row.hz).padStart(14)} ${formatMilliseconds(row.latencyMs).padStart(10)} ${formatMilliseconds(row.semMs).padStart(10)} ${formatNumber(row.rme).padStart(8)} ${ratio}  ${row.description}`,
    );
  }
}

function printCodSpeedScenarioTable(rows: Array<ScenarioRecord & { name: ScenarioName }>): void {
  if (rows.length === 0) return;
  logger.info("");
  logger.info("CodSpeed profile scenarios (higher ops/sec is better):");
  logger.info("");
  logger.info(
    `${"Scenario".padEnd(28)} ${"ops/sec".padStart(14)} ${"mean ms".padStart(10)} ${"sem ms".padStart(10)} ${"rme %".padStart(8)}  Description`,
  );
  logger.info(
    `${"-".repeat(28)} ${"-".repeat(14)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(8)}  ${"-".repeat(40)}`,
  );
  for (const row of rows) {
    logger.info(
      `${row.name.padEnd(28)} ${formatNumber(row.hz).padStart(14)} ${formatMilliseconds(row.latencyMs).padStart(10)} ${formatMilliseconds(row.semMs).padStart(10)} ${formatNumber(row.rme).padStart(8)}  ${row.description}`,
    );
  }
}

function printSyncReferenceTable(
  rows: Array<
    RepeatedTinybenchRecord & {
      name: ScenarioName;
      description: string;
      aliases?: readonly string[];
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
      `${row.name.padEnd(28)} ${formatNumber(row.hz).padStart(14)} ${formatMilliseconds(row.latencyMs).padStart(10)} ${formatMilliseconds(row.semMs).padStart(10)} ${formatNumber(row.rme).padStart(8)}  ${row.description}`,
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
    "- CodSpeed scenarios mirror CI bench names; use them when a PR regression names a specific bench.",
  );
  logger.info(
    "- compose.rawSyncYieldStar: sync-only reference; compare absolute ops/sec, not baseline ratios.",
  );
  logger.info("");
  logger.info("Machine-readable output:");
  logger.info(
    `  pnpm --filter @prodkit/benchmarks run profile -- --report=${resolveProfileArtifact("profile.json")}`,
  );
  logger.info("");
  logger.info("CPU profile (flame graph):");
  logger.info(
    "  pnpm --filter @prodkit/benchmarks run profile:cpu -- --scenario=compose.opYieldChain",
  );
  logger.info(
    "  Open the emitted *.cpuprofile in .profiles/op/ via Chrome DevTools or https://speedscope.app",
  );
  logger.info("");
  logger.info("Heap profile (allocations):");
  logger.info("  pnpm --filter @prodkit/benchmarks run profile:heap -- --scenario=all.opAll");
  logger.info("  Open the emitted *.heapprofile in .profiles/op/ via Chrome DevTools Memory");
}

async function measureAsyncScenario(
  spec: AsyncScenarioSpec,
  steps: number,
  benchOptions: BenchRunOptions,
): Promise<ScenarioRecord> {
  const record = await runTinybenchRepeatedVariant(spec.name, () => spec.run(steps), benchOptions);
  return {
    ...record,
    description: spec.description,
    group: spec.group,
    aliases: spec.aliases,
    ratioToBaseline: null,
  };
}

async function measureSyncScenario(
  spec: SyncScenarioSpec,
  steps: number,
  benchOptions: BenchRunOptions,
): Promise<
  RepeatedTinybenchRecord & { description: string; aliases?: readonly string[]; note: string }
> {
  const record = await runTinybenchRepeatedVariant(spec.name, () => spec.run(steps), benchOptions);
  return {
    ...record,
    description: spec.description,
    aliases: spec.aliases,
    note: "Sync-only reference scenario; excluded from async baseline ratios.",
  };
}

async function runProfileLoop(
  spec: ScenarioSpec,
  steps: number,
  iterations: number,
): Promise<void> {
  logger.info(`Profiling ${spec.name} (${iterations.toLocaleString("en-US")} iterations)...`);
  for (let index = 0; index < iterations; index += 1) {
    if (spec.kind === "async") {
      await spec.run(steps);
    } else {
      spec.run(steps);
    }
  }
}

function defaultProfileIterations(spec: ScenarioSpec, mode: ProfileIterationMode): number {
  return (
    spec.profileIterations?.[mode] ??
    (mode === "cpu" ? DEFAULT_PROFILE_CPU_ITERATIONS : DEFAULT_PROFILE_HEAP_ITERATIONS)
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const repoRoot = getRepoRoot();
  const packageDir = resolveOpPackageDir(repoRoot, parseArgValue(argv, "--package-dir="));
  const profileMode = parseProfileMode(argv);
  const scenarioFilter = parseArgValue(argv, "--scenario=");
  const benchOptions = parseBenchRunOptions(argv);
  const steps = parseStepsArg(argv);
  const reportPath = parseReportPath(argv) ?? resolveProfileArtifact("profile.json");
  const calibrationPath = parseArgValue(argv, "--calibration=");
  const iterationsArg = parseArgValue(argv, "--iterations=");
  const commit = readGitCommitMetadata(repoRoot);
  const environment = readEnvironmentReport();
  const resolvedBenchOptions = resolveBenchRunOptions(benchOptions);
  const calibration = await readBenchmarkCalibrationAttachment(repoRoot, calibrationPath);
  const generatedAt = new Date().toISOString();

  const { Op: opModule } = await importOpModule(packageDir);
  const { Policy: policyModule } = await importOpPolicyModule(packageDir);
  const Op = asBenchOp(opModule);
  const runtime = {
    Op: asComparisonOp(opModule),
    Policy: asComparisonPolicy(policyModule),
  };
  const packageVersion = await readPackageVersion(packageDir);
  const scenarios = createProfileScenarios(Op, runtime);
  const selected = selectScenarios(scenarios, scenarioFilter);

  logger.info(
    `Profile environment: node=${process.version} platform=${process.platform} arch=${process.arch}`,
  );
  logger.info(`Profile target: ${packageDir} (@prodkit/op@${packageVersion})`);
  logger.info(`Profile mode: ${profileMode}`);
  logger.info(`Compose steps: ${steps}`);
  logger.info(`Benchmark timing: ${benchRunOptionSummary(benchOptions)}`);

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
    const profileLoopIterations =
      iterationsArg === undefined
        ? defaultProfileIterations(spec, profileMode)
        : parsePositiveInt(iterationsArg, "iterations");

    await ensureBenchmarkProfileDir();
    const artifactsDir = path.resolve(BENCHMARK_PROFILE_DIR);
    const startedAt = Date.now();
    await runProfileLoop(spec, steps, profileLoopIterations);
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

  const asyncRows: Array<ScenarioRecord & { name: ScenarioName }> = [];
  for (const spec of asyncSelected) {
    const record = await measureAsyncScenario(spec, steps, benchOptions);
    asyncRows.push({ name: spec.name, ...record });
  }

  const composeRows = asyncRows.filter((row) => row.group === "compose");
  const codSpeedRows = asyncRows.filter((row) => row.group === "codspeed");
  const baseline = composeRows.find((row) => row.name === "baseline.asyncChain");
  if (baseline !== undefined && baseline.hz > 0) {
    for (const row of composeRows) {
      row.ratioToBaseline = baseline.hz / row.hz;
    }
  }

  const syncRows: Array<
    RepeatedTinybenchRecord & {
      name: ScenarioName;
      description: string;
      aliases?: readonly string[];
      note: string;
    }
  > = [];
  for (const spec of syncSelected) {
    const record = await measureSyncScenario(spec, steps, benchOptions);
    syncRows.push({ name: spec.name, ...record });
  }

  printAsyncBreakdownTable(composeRows, steps);
  printCodSpeedScenarioTable(codSpeedRows);
  if (syncRows.length > 0) {
    printSyncReferenceTable(syncRows);
  }
  printInterpretationGuide();

  if (reportPath !== undefined) {
    const officialProfileScenarios: ProfileScenarioOfficialInput[] = [
      ...asyncRows.map((row) => ({
        name: row.name,
        hz: row.hz,
        latencyMs: row.latencyMs,
        latencyMinMs: row.latencyMinMs,
        latencyMaxMs: row.latencyMaxMs,
        semMs: row.semMs,
        rme: row.rme,
        sampleCount: row.sampleCount,
        repeats: row.repeats,
        description: row.description,
        group: row.group,
        aliases: row.aliases,
      })),
      ...syncRows.map((row) => ({
        name: row.name,
        hz: row.hz,
        latencyMs: row.latencyMs,
        latencyMinMs: row.latencyMinMs,
        latencyMaxMs: row.latencyMaxMs,
        semMs: row.semMs,
        rme: row.rme,
        sampleCount: row.sampleCount,
        repeats: row.repeats,
        description: row.description,
        group: "syncReference",
        aliases: row.aliases,
      })),
    ];
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
        repeats: row.repeats,
        description: row.description,
        group: row.group,
        aliases: row.aliases,
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
        repeats: row.repeats,
        description: row.description,
        aliases: row.aliases,
        note: row.note,
      };
    }

    const officialFields = createOfficialBenchmarkReportFields({
      kind: "profile",
      generatedAt,
      repoRoot,
      reportPath,
      environment,
      benchOptions: resolvedBenchOptions,
      commit,
      packages: [createPackageMetadata(repoRoot, "@prodkit/op", packageVersion, packageDir)],
      scenarioResults: profileScenariosToOfficialResults(officialProfileScenarios),
      calibration,
    });

    const report: ProfileReport = {
      ...officialFields,
      generatedAt,
      environment,
      target: {
        packageDir,
        packageVersion,
      },
      benchOptions: resolvedBenchOptions,
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

if (import.meta.main) {
  main().catch((error) => {
    logger.error(error);
    process.exitCode = 1;
  });
}
