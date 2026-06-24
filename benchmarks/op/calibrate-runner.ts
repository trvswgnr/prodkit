import path from "node:path";
import {
  asComparisonOp,
  asComparisonPolicy,
  createComparisonScenarios,
  type ComparisonScenario,
} from "./comparison-matrix.ts";
import {
  benchRunOptionSummary,
  getRepoRoot,
  parseArgValue,
  parseBenchRunOptions,
  parsePositiveInt,
  readEnvironmentReport,
  readPackageVersion,
  resolveBenchRunOptions,
  resolveOpPackageDir,
  resolveReportPath,
  runTinybenchRepeatedVariant,
  writeJsonReport,
  type BenchRunOptions,
  type RepeatedTinybenchRecord,
} from "./harness.ts";
import {
  BENCHMARK_CALIBRATION_REPORT_VERSION,
  createDependencyFingerprint,
  createPackageMetadata,
  createRunnerIdentity,
  readGitCommitMetadata,
  type BenchmarkCalibrationRecommendation,
  type BenchmarkCalibrationReport,
  type BenchmarkCalibrationSampleSummary,
  type BenchmarkCalibrationScenarioSummary,
  type BenchmarkCalibrationThresholds,
} from "./official-report.ts";
import { Op } from "@prodkit/op";
import { Policy } from "@prodkit/op/policy";

export const DEFAULT_CALIBRATION_SAMPLE_COUNT = 3;
export const DEFAULT_MICROBENCHMARK_NOISE_THRESHOLD_RATIO = 0.05;
export const DEFAULT_WORKFLOW_NOISE_THRESHOLD_RATIO = 0.1;

const logger = console;

type CalibrationSide = "left" | "right";

export type RunnerCalibrationCliArgs = {
  reportPath: string;
  benchOptions: BenchRunOptions;
  sampleCount: number;
  thresholds: BenchmarkCalibrationThresholds;
};

export type CalibrationScenarioSampleInput = {
  sampleIndex: number;
  first: CalibrationSide;
  left: RepeatedTinybenchRecord;
  right: RepeatedTinybenchRecord;
};

export type CalibrationScenarioSummaryInput = {
  key: string;
  label: string;
  benchName: string;
  samples: readonly CalibrationScenarioSampleInput[];
};

function usage(): string {
  return [
    "usage: node ./op/calibrate-runner.ts",
    "  [--report=op/.artifacts/runner-calibration-report.json]",
    "  [--samples=3]",
    "  [--micro-threshold=0.05] [--workflow-threshold=0.1]",
    "  [--time=300] [--warmup-time=150] [--warmup-iterations=5] [--repeats=1]",
  ].join("\n");
}

function parseRatioArg(argv: readonly string[], prefix: string, defaultValue: number): number {
  const value = parseArgValue(argv, prefix);
  if (value === undefined) return defaultValue;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${prefix} value. Expected a non-negative ratio.`);
  }
  return parsed;
}

export function parseRunnerCalibrationArgs(
  argv: readonly string[] = process.argv.slice(2),
): RunnerCalibrationCliArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    throw new Error(usage());
  }
  const sampleCountArg = parseArgValue(argv, "--samples=");
  return {
    reportPath: resolveReportPath(argv, "runner-calibration-report.json"),
    benchOptions: parseBenchRunOptions(argv),
    sampleCount:
      sampleCountArg === undefined
        ? DEFAULT_CALIBRATION_SAMPLE_COUNT
        : parsePositiveInt(sampleCountArg, "samples"),
    thresholds: {
      microbenchmarkNoiseRatio: parseRatioArg(
        argv,
        "--micro-threshold=",
        DEFAULT_MICROBENCHMARK_NOISE_THRESHOLD_RATIO,
      ),
      workflowNoiseRatio: parseRatioArg(
        argv,
        "--workflow-threshold=",
        DEFAULT_WORKFLOW_NOISE_THRESHOLD_RATIO,
      ),
    },
  };
}

function relativeDeltaRatio(leftHz: number, rightHz: number): number {
  if (leftHz === 0) return rightHz === 0 ? 0 : 1;
  return (rightHz - leftHz) / leftHz;
}

function combinedNoiseRatio(left: RepeatedTinybenchRecord, right: RepeatedTinybenchRecord): number {
  return Math.hypot(left.rme / 100, right.rme / 100);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const upper = sorted[midpoint] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[midpoint - 1] ?? upper;
  return (lower + upper) / 2;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeCalibrationScenario(
  input: CalibrationScenarioSummaryInput,
): BenchmarkCalibrationScenarioSummary {
  const samples: BenchmarkCalibrationSampleSummary[] = input.samples.map((sample) => {
    const deltaRatio = relativeDeltaRatio(sample.left.hz, sample.right.hz);
    return {
      sampleIndex: sample.sampleIndex,
      first: sample.first,
      leftHz: sample.left.hz,
      rightHz: sample.right.hz,
      deltaRatio,
      absoluteDeltaRatio: Math.abs(deltaRatio),
      combinedNoiseRatio: combinedNoiseRatio(sample.left, sample.right),
    };
  });
  const absoluteDeltas = samples.map((sample) => sample.absoluteDeltaRatio);
  const combinedNoise = samples.map((sample) => sample.combinedNoiseRatio);
  const maxAbsoluteDeltaRatio = Math.max(0, ...absoluteDeltas);
  const averageCombinedNoiseRatio = average(combinedNoise);

  return {
    key: input.key,
    label: input.label,
    benchName: input.benchName,
    sampleCount: samples.length,
    medianAbsoluteDeltaRatio: median(absoluteDeltas),
    p95AbsoluteDeltaRatio: percentile(absoluteDeltas, 0.95),
    maxAbsoluteDeltaRatio,
    averageCombinedNoiseRatio,
    noiseBandRatio: Math.max(maxAbsoluteDeltaRatio, averageCombinedNoiseRatio),
    samples,
  };
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

function worstScenario(
  summaries: readonly BenchmarkCalibrationScenarioSummary[],
): BenchmarkCalibrationScenarioSummary {
  const worst = summaries.reduce<BenchmarkCalibrationScenarioSummary | undefined>(
    (current, candidate) =>
      current === undefined || candidate.noiseBandRatio > current.noiseBandRatio
        ? candidate
        : current,
    undefined,
  );
  if (worst === undefined) {
    throw new Error("Calibration requires at least one scenario summary.");
  }
  return worst;
}

export function createCalibrationRecommendation(
  summaries: readonly BenchmarkCalibrationScenarioSummary[],
  thresholdRatio: number,
): BenchmarkCalibrationRecommendation {
  const worst = worstScenario(summaries);
  const decision = worst.noiseBandRatio <= thresholdRatio ? "acceptable" : "noisy";
  return {
    decision,
    thresholdRatio,
    worstNoiseBandRatio: worst.noiseBandRatio,
    worstScenarioKey: worst.key,
    reason:
      decision === "acceptable"
        ? `Worst observed noise band ${formatPercent(
            worst.noiseBandRatio,
          )} is within the ${formatPercent(thresholdRatio)} threshold.`
        : `Worst observed noise band ${formatPercent(
            worst.noiseBandRatio,
          )} exceeds the ${formatPercent(thresholdRatio)} threshold.`,
  };
}

export function createBenchmarkCalibrationReport(input: {
  generatedAt: string;
  repoRoot: string;
  packageDir: string;
  packageVersion: string;
  benchOptions: ReturnType<typeof resolveBenchRunOptions>;
  sampleCount: number;
  thresholds: BenchmarkCalibrationThresholds;
  scenarioSummaries: BenchmarkCalibrationScenarioSummary[];
}): BenchmarkCalibrationReport {
  const environment = readEnvironmentReport();
  return {
    schemaVersion: BENCHMARK_CALIBRATION_REPORT_VERSION,
    generatedAt: input.generatedAt,
    runner: createRunnerIdentity(environment, process.env, input.repoRoot),
    commit: readGitCommitMetadata(input.repoRoot),
    packages: [
      createPackageMetadata(input.repoRoot, "@prodkit/op", input.packageVersion, input.packageDir),
    ],
    dependencyFingerprint: createDependencyFingerprint(input.repoRoot),
    benchOptions: input.benchOptions,
    sampleCount: input.sampleCount,
    thresholds: input.thresholds,
    recommendations: {
      microbenchmark: createCalibrationRecommendation(
        input.scenarioSummaries,
        input.thresholds.microbenchmarkNoiseRatio,
      ),
      workflow: createCalibrationRecommendation(
        input.scenarioSummaries,
        input.thresholds.workflowNoiseRatio,
      ),
    },
    scenarioSummaries: input.scenarioSummaries,
  };
}

function scenarioCell(scenario: ComparisonScenario) {
  const cell = scenario.implementations.op;
  if (cell === undefined) {
    throw new Error(`Scenario ${scenario.key} is missing an op implementation.`);
  }
  return cell;
}

function calibrationRunOrder(
  scenarioIndex: number,
  sampleIndex: number,
): readonly [CalibrationSide, CalibrationSide] {
  return (scenarioIndex + sampleIndex) % 2 === 0 ? ["left", "right"] : ["right", "left"];
}

async function measureEquivalentPair(
  scenario: ComparisonScenario,
  scenarioIndex: number,
  sampleIndex: number,
  benchOptions: BenchRunOptions,
): Promise<CalibrationScenarioSampleInput> {
  const cell = scenarioCell(scenario);
  const order = calibrationRunOrder(scenarioIndex, sampleIndex);
  const results: Partial<Record<CalibrationSide, RepeatedTinybenchRecord>> = {};
  for (const side of order) {
    results[side] = await runTinybenchRepeatedVariant(cell.benchName, cell.run, benchOptions);
  }
  const left = results.left;
  const right = results.right;
  if (left === undefined || right === undefined) {
    throw new Error(`Missing calibration pair result for ${scenario.key}.`);
  }
  return {
    sampleIndex,
    first: order[0],
    left,
    right,
  };
}

function formatCalibrationSummary(report: BenchmarkCalibrationReport): string {
  const lines = [
    "Benchmark runner calibration",
    `Runner: ${report.runner.id}`,
    `Benchmark timing: ${benchRunOptionSummary(report.benchOptions)}`,
    `Samples per scenario: ${report.sampleCount}`,
    `Microbenchmark recommendation: ${report.recommendations.microbenchmark.decision} (worst ${formatPercent(
      report.recommendations.microbenchmark.worstNoiseBandRatio,
    )}, threshold ${formatPercent(report.thresholds.microbenchmarkNoiseRatio)})`,
    `Workflow recommendation: ${report.recommendations.workflow.decision} (worst ${formatPercent(
      report.recommendations.workflow.worstNoiseBandRatio,
    )}, threshold ${formatPercent(report.thresholds.workflowNoiseRatio)})`,
    "",
    `${"Scenario".padEnd(32)} ${"Noise band".padStart(12)} ${"Median".padStart(10)} ${"P95".padStart(10)} ${"Max".padStart(10)}`,
    `${"-".repeat(32)} ${"-".repeat(12)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)}`,
  ];

  for (const scenario of report.scenarioSummaries) {
    lines.push(
      `${scenario.label.padEnd(32)} ${formatPercent(scenario.noiseBandRatio).padStart(
        12,
      )} ${formatPercent(scenario.medianAbsoluteDeltaRatio).padStart(10)} ${formatPercent(
        scenario.p95AbsoluteDeltaRatio,
      ).padStart(10)} ${formatPercent(scenario.maxAbsoluteDeltaRatio).padStart(10)}`,
    );
  }

  return lines.join("\n");
}

export async function runRunnerCalibration(
  args: RunnerCalibrationCliArgs,
): Promise<BenchmarkCalibrationReport> {
  const repoRoot = getRepoRoot();
  const packageDir = resolveOpPackageDir(repoRoot);
  const packageVersion = await readPackageVersion(packageDir);
  const benchOptions = resolveBenchRunOptions(args.benchOptions);
  const scenarios = createComparisonScenarios({
    Op: asComparisonOp(Op),
    Policy: asComparisonPolicy(Policy),
  });

  logger.info(
    `Runner calibration target: @prodkit/op@${packageVersion} (${process.version}, ${process.platform}/${process.arch})`,
  );
  logger.info(`Benchmark timing: ${benchRunOptionSummary(args.benchOptions)}`);
  logger.info(`Samples per scenario: ${args.sampleCount}`);

  const scenarioSummaries: BenchmarkCalibrationScenarioSummary[] = [];
  for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
    const scenario = scenarios[scenarioIndex];
    if (scenario === undefined) {
      throw new Error("Missing calibration scenario.");
    }

    logger.info(`Calibrating ${scenario.label}...`);
    const samples: CalibrationScenarioSampleInput[] = [];
    for (let sampleIndex = 0; sampleIndex < args.sampleCount; sampleIndex += 1) {
      samples.push(
        await measureEquivalentPair(scenario, scenarioIndex, sampleIndex, args.benchOptions),
      );
    }
    scenarioSummaries.push(
      summarizeCalibrationScenario({
        key: scenario.key,
        label: scenario.label,
        benchName: scenarioCell(scenario).benchName,
        samples,
      }),
    );
  }

  const report = createBenchmarkCalibrationReport({
    generatedAt: new Date().toISOString(),
    repoRoot,
    packageDir,
    packageVersion,
    benchOptions,
    sampleCount: args.sampleCount,
    thresholds: args.thresholds,
    scenarioSummaries,
  });

  await writeJsonReport(args.reportPath, report);
  logger.info("");
  logger.info(formatCalibrationSummary(report));
  logger.info("");
  logger.info(`Wrote runner calibration report: ${path.resolve(args.reportPath)}`);
  logger.info(`Attach it to official benchmark reports with: --calibration=${args.reportPath}`);
  return report;
}

export async function runRunnerCalibrationCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  await runRunnerCalibration(parseRunnerCalibrationArgs(argv));
}

if (import.meta.main) {
  runRunnerCalibrationCli().catch((error) => {
    logger.error(error);
    process.exitCode = 1;
  });
}
