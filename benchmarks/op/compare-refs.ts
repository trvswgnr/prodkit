import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IMPLEMENTATION_COLUMNS,
  asComparisonOp,
  asComparisonPolicy,
  createComparisonScenarios,
  type ComparisonScenario,
  type ImplementationColumn,
} from "./comparison-matrix.ts";
import {
  benchRunOptionSummary,
  getRepoRoot,
  importOpModule,
  importOpPolicyModule,
  parseArgValue,
  parseBenchRunOptions,
  readEnvironmentReport,
  readPackageVersion,
  resolveBenchRunOptions,
  resolveOpPackageDir,
  resolveReportPath,
  runTinybenchRepeatedVariant,
  writeJsonReport,
  type BenchRunOptions,
  type EnvironmentReport,
  type RepeatedTinybenchRecord,
  type ResolvedBenchRunOptions,
} from "./harness.ts";
import {
  DEFAULT_MIN_MEANINGFUL_CHANGE_RATIO,
  OFFICIAL_BENCHMARK_REPORT_VERSION,
  comparisonScenariosToOfficialResults,
  createBenchmarkRunId,
  createDependencyFingerprint,
  createPackageMetadata,
  createRunnerIdentity,
  diffOfficialBenchmarkReports,
  formatBenchmarkDiff,
  readGitCommitMetadata,
  reportArtifactRef,
  type BenchmarkCommitMetadata,
  type BenchmarkDiff,
  type OfficialBenchmarkReport,
  type OfficialScenarioResult,
} from "./official-report.ts";

export const TRUSTED_REF_COMPARISON_REPORT_VERSION = "prodkit.benchmark-ref-comparison.v1" as const;
export const TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID = "op" as const;

const logger = console;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export type RefComparisonSide = "base" | "candidate";

export type ScenarioExecutionOrderEntry = {
  scenarioKey: string;
  first: RefComparisonSide;
};

export type TrustedRefComparisonCliArgs = {
  baseRef: string;
  candidateRef: string;
  reportPath: string;
  benchOptions: BenchRunOptions;
  minMeaningfulChangeRatio: number;
};

export type TrustedRefComparisonSideReport = {
  ref: string;
  sha: string;
  packageVersion: string;
  report: OfficialBenchmarkReport;
};

export type TrustedRefComparisonReport = {
  schemaVersion: typeof TRUSTED_REF_COMPARISON_REPORT_VERSION;
  generatedAt: string;
  implementationId: typeof TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID;
  benchOptions: ResolvedBenchRunOptions;
  scenarioOrder: ScenarioExecutionOrderEntry[];
  base: TrustedRefComparisonSideReport;
  candidate: TrustedRefComparisonSideReport;
  diff: BenchmarkDiff;
};

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type PreparedRefWorktree = {
  ref: string;
  sha: string;
  root: string;
  packageDir: string;
  packageVersion: string;
  scenarios: readonly ComparisonScenario[];
  commit: BenchmarkCommitMetadata;
};

type ScenarioPairResults = {
  base: RepeatedTinybenchRecord;
  candidate: RepeatedTinybenchRecord;
};

type BuildOfficialReportInput = {
  ref: string;
  sha: string;
  generatedAt: string;
  reportPath: string;
  artifactRepoRoot: string;
  worktreeRoot: string;
  packageDir: string;
  packageVersion: string;
  environment: EnvironmentReport;
  benchOptions: ResolvedBenchRunOptions;
  commit: BenchmarkCommitMetadata;
  scenarioResults: OfficialScenarioResult[];
};

function usage(): string {
  return [
    "usage: node ./op/compare-refs.ts --base=<ref> --candidate=<ref>",
    "  [--report=op/.artifacts/trusted-ref-comparison-report.json]",
    "  [--time=300] [--warmup-time=150] [--warmup-iterations=5] [--repeats=1]",
    "  [--min-change=0.02]",
  ].join("\n");
}

function parseMinMeaningfulChangeRatio(argv: readonly string[]): number {
  const value = parseArgValue(argv, "--min-change=");
  if (value === undefined) return DEFAULT_MIN_MEANINGFUL_CHANGE_RATIO;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Invalid --min-change value. Expected a non-negative ratio.");
  }
  return parsed;
}

export function parseTrustedRefComparisonArgs(
  argv: readonly string[],
): TrustedRefComparisonCliArgs {
  const baseRef = parseArgValue(argv, "--base=");
  const candidateRef = parseArgValue(argv, "--candidate=");
  if (baseRef === undefined || candidateRef === undefined) {
    throw new Error(usage());
  }

  return {
    baseRef,
    candidateRef,
    reportPath: resolveReportPath(argv, "trusted-ref-comparison-report.json"),
    benchOptions: parseBenchRunOptions(argv),
    minMeaningfulChangeRatio: parseMinMeaningfulChangeRatio(argv),
  };
}

function spawnCapture(command: string, args: readonly string[], cwd: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runCommand(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
  }
}

function runGitCapture(repoRoot: string, args: readonly string[]): string {
  const result = spawnCapture("git", args, repoRoot);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function runGit(repoRoot: string, args: readonly string[]): void {
  runCommand("git", args, repoRoot);
}

export function assertCleanGitStatus(status: string, label = "working tree"): void {
  if (status.trim().length === 0) return;
  throw new Error(
    `Trusted benchmark comparisons require a clean ${label}. Commit, stash, or remove local changes first.`,
  );
}

function assertCleanGitWorktree(repoRoot: string, label = "working tree"): void {
  assertCleanGitStatus(runGitCapture(repoRoot, ["status", "--porcelain"]), label);
}

export function normalizeResolvedGitCommit(ref: string, output: string): string {
  const sha = output.trim().toLowerCase();
  if (!GIT_COMMIT_PATTERN.test(sha)) {
    throw new Error(`Invalid git ref "${ref}". Expected a commit-ish ref.`);
  }
  return sha;
}

function resolveGitCommit(repoRoot: string, ref: string): string {
  return normalizeResolvedGitCommit(
    ref,
    runGitCapture(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]),
  );
}

export function assertDistinctResolvedRefs(baseSha: string, candidateSha: string): void {
  if (baseSha !== candidateSha) return;
  throw new Error("Base and candidate refs must resolve to different commits.");
}

function opImplementationColumn(): ImplementationColumn {
  const column = IMPLEMENTATION_COLUMNS.find(
    (item) => item.id === TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
  );
  if (column === undefined) {
    throw new Error("Missing op implementation column.");
  }
  return column;
}

export function refComparisonRunOrder(
  scenarioIndex: number,
): readonly [RefComparisonSide, RefComparisonSide] {
  return scenarioIndex % 2 === 0 ? ["base", "candidate"] : ["candidate", "base"];
}

export function createScenarioExecutionOrder(
  scenarios: readonly Pick<ComparisonScenario, "key">[],
): ScenarioExecutionOrderEntry[] {
  return scenarios.map((scenario, index) => ({
    scenarioKey: scenario.key,
    first: refComparisonRunOrder(index)[0],
  }));
}

function sideResult(
  results: Partial<Record<RefComparisonSide, RepeatedTinybenchRecord>>,
  side: RefComparisonSide,
): RepeatedTinybenchRecord {
  const result = results[side];
  if (result === undefined) {
    throw new Error(`Missing benchmark result for ${side}.`);
  }
  return result;
}

function scenarioCell(scenario: ComparisonScenario) {
  const cell = scenario.implementations[TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID];
  if (cell === undefined) {
    throw new Error(`Scenario ${scenario.key} is missing an op implementation.`);
  }
  return cell;
}

async function runScenarioPair(
  baseScenario: ComparisonScenario,
  candidateScenario: ComparisonScenario,
  scenarioIndex: number,
  benchOptions: BenchRunOptions,
): Promise<ScenarioPairResults> {
  if (baseScenario.key !== candidateScenario.key) {
    throw new Error(
      `Scenario mismatch: base ${baseScenario.key} and candidate ${candidateScenario.key}.`,
    );
  }

  const results: Partial<Record<RefComparisonSide, RepeatedTinybenchRecord>> = {};
  for (const side of refComparisonRunOrder(scenarioIndex)) {
    const scenario = side === "base" ? baseScenario : candidateScenario;
    const cell = scenarioCell(scenario);
    results[side] = await runTinybenchRepeatedVariant(cell.benchName, cell.run, benchOptions);
  }

  return {
    base: sideResult(results, "base"),
    candidate: sideResult(results, "candidate"),
  };
}

function createOpOnlyOfficialResults(
  scenarios: readonly ComparisonScenario[],
  runtime: readonly RepeatedTinybenchRecord[],
): OfficialScenarioResult[] {
  const opColumn = opImplementationColumn();
  return comparisonScenariosToOfficialResults(
    scenarios.map((scenario, index) => {
      const stats = runtime[index];
      if (stats === undefined) {
        throw new Error(`Missing benchmark stats for scenario ${scenario.key}.`);
      }
      const cell = scenarioCell(scenario);
      return {
        key: scenario.key,
        label: scenario.label,
        implementations: {
          [TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID]: {
            benchName: cell.benchName,
            description: cell.description,
          },
        },
        runtime: {
          [TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID]: stats,
        },
      };
    }),
    [opColumn],
  );
}

function createOfficialReportForRef(input: BuildOfficialReportInput): OfficialBenchmarkReport {
  return {
    schemaVersion: OFFICIAL_BENCHMARK_REPORT_VERSION,
    run: {
      id: createBenchmarkRunId("comparison", input.generatedAt, input.commit),
      kind: "comparison",
      generatedAt: input.generatedAt,
      artifacts: [reportArtifactRef(input.artifactRepoRoot, input.reportPath)],
    },
    runner: createRunnerIdentity(input.environment),
    commit: input.commit,
    packages: [
      createPackageMetadata(
        input.worktreeRoot,
        "@prodkit/op",
        input.packageVersion,
        input.packageDir,
      ),
    ],
    dependencyFingerprint: createDependencyFingerprint(input.worktreeRoot),
    environment: input.environment,
    benchOptions: input.benchOptions,
    scenarioResults: input.scenarioResults,
  };
}

export function createTrustedRefComparisonReport(input: {
  generatedAt: string;
  benchOptions: ResolvedBenchRunOptions;
  scenarioOrder: ScenarioExecutionOrderEntry[];
  baseRef: string;
  baseSha: string;
  basePackageVersion: string;
  baseReport: OfficialBenchmarkReport;
  candidateRef: string;
  candidateSha: string;
  candidatePackageVersion: string;
  candidateReport: OfficialBenchmarkReport;
  minMeaningfulChangeRatio?: number;
}): TrustedRefComparisonReport {
  const diff = diffOfficialBenchmarkReports(input.baseReport, input.candidateReport, {
    implementationId: TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
    minMeaningfulChangeRatio: input.minMeaningfulChangeRatio,
  });

  return {
    schemaVersion: TRUSTED_REF_COMPARISON_REPORT_VERSION,
    generatedAt: input.generatedAt,
    implementationId: TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
    benchOptions: input.benchOptions,
    scenarioOrder: input.scenarioOrder,
    base: {
      ref: input.baseRef,
      sha: input.baseSha,
      packageVersion: input.basePackageVersion,
      report: input.baseReport,
    },
    candidate: {
      ref: input.candidateRef,
      sha: input.candidateSha,
      packageVersion: input.candidatePackageVersion,
      report: input.candidateReport,
    },
    diff,
  };
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function countFirstRuns(
  order: readonly ScenarioExecutionOrderEntry[],
  side: RefComparisonSide,
): number {
  return order.filter((entry) => entry.first === side).length;
}

export function formatTrustedRefComparisonSummary(report: TrustedRefComparisonReport): string {
  const lines = [
    `Trusted ref comparison (${report.implementationId})`,
    `Base: ${report.base.ref} (${shortSha(report.base.sha)})`,
    `Candidate: ${report.candidate.ref} (${shortSha(report.candidate.sha)})`,
    `Benchmark timing: ${benchRunOptionSummary(report.benchOptions)}`,
    `Scenario order: alternated by scenario (${countFirstRuns(
      report.scenarioOrder,
      "base",
    )} base first, ${countFirstRuns(report.scenarioOrder, "candidate")} candidate first)`,
    "",
    formatBenchmarkDiff(report.diff),
  ];
  return lines.join("\n");
}

async function prepareRefWorktree(input: {
  repoRoot: string;
  tempRoot: string;
  side: RefComparisonSide;
  ref: string;
  sha: string;
}): Promise<PreparedRefWorktree> {
  const worktreeRoot = path.join(input.tempRoot, input.side);
  logger.info(`Preparing ${input.side} ref ${input.ref} (${shortSha(input.sha)})...`);
  runGit(input.repoRoot, ["worktree", "add", "--detach", worktreeRoot, input.sha]);
  assertCleanGitWorktree(worktreeRoot, `${input.side} worktree`);

  logger.info(`Installing ${input.side} dependencies...`);
  runCommand("pnpm", ["install", "--frozen-lockfile"], worktreeRoot);

  logger.info(`Building ${input.side} @prodkit/op...`);
  runCommand("pnpm", ["--filter", "@prodkit/op", "run", "build"], worktreeRoot);
  assertCleanGitWorktree(worktreeRoot, `${input.side} worktree after build`);

  const packageDir = resolveOpPackageDir(worktreeRoot);
  const packageVersion = await readPackageVersion(packageDir);
  const opModule = await importOpModule(packageDir);
  const policyModule = await importOpPolicyModule(packageDir);
  const scenarios = createComparisonScenarios({
    Op: asComparisonOp(opModule.Op),
    Policy: asComparisonPolicy(policyModule.Policy),
  });

  return {
    ref: input.ref,
    sha: input.sha,
    root: worktreeRoot,
    packageDir,
    packageVersion,
    scenarios,
    commit: readGitCommitMetadata(worktreeRoot),
  };
}

async function removeWorktree(repoRoot: string, worktreeRoot: string): Promise<void> {
  const result = spawnCapture("git", ["worktree", "remove", "--force", worktreeRoot], repoRoot);
  if (result.status !== 0) {
    logger.warn(`Unable to remove worktree ${worktreeRoot}: ${result.stderr || result.stdout}`);
  }
}

export async function runTrustedRefComparison(
  args: TrustedRefComparisonCliArgs,
): Promise<TrustedRefComparisonReport> {
  const repoRoot = getRepoRoot();
  assertCleanGitWorktree(repoRoot);

  const baseSha = resolveGitCommit(repoRoot, args.baseRef);
  const candidateSha = resolveGitCommit(repoRoot, args.candidateRef);
  assertDistinctResolvedRefs(baseSha, candidateSha);

  const generatedAt = new Date().toISOString();
  const environment = readEnvironmentReport();
  const resolvedBenchOptions = resolveBenchRunOptions(args.benchOptions);
  const tempRoot = await mkdtemp(path.join(tmpdir(), "prodkit-benchmark-refs-"));
  const worktrees: string[] = [];

  try {
    worktrees.push(path.join(tempRoot, "base"));
    const base = await prepareRefWorktree({
      repoRoot,
      tempRoot,
      side: "base",
      ref: args.baseRef,
      sha: baseSha,
    });
    worktrees.push(path.join(tempRoot, "candidate"));
    const candidate = await prepareRefWorktree({
      repoRoot,
      tempRoot,
      side: "candidate",
      ref: args.candidateRef,
      sha: candidateSha,
    });

    logger.info(
      `Trusted comparison target: ${args.baseRef} (${shortSha(baseSha)}) vs ${args.candidateRef} (${shortSha(candidateSha)})`,
    );
    logger.info(`Benchmark timing: ${benchRunOptionSummary(args.benchOptions)}`);

    const baseStats: RepeatedTinybenchRecord[] = [];
    const candidateStats: RepeatedTinybenchRecord[] = [];
    for (let index = 0; index < base.scenarios.length; index += 1) {
      const baseScenario = base.scenarios[index];
      const candidateScenario = candidate.scenarios[index];
      if (baseScenario === undefined || candidateScenario === undefined) {
        throw new Error("Base and candidate scenario counts differ.");
      }
      logger.info(`Benchmarking ${baseScenario.label}...`);
      const result = await runScenarioPair(
        baseScenario,
        candidateScenario,
        index,
        args.benchOptions,
      );
      baseStats.push(result.base);
      candidateStats.push(result.candidate);
    }

    const scenarioOrder = createScenarioExecutionOrder(base.scenarios);
    const baseReport = createOfficialReportForRef({
      ref: args.baseRef,
      sha: baseSha,
      generatedAt,
      reportPath: args.reportPath,
      artifactRepoRoot: repoRoot,
      worktreeRoot: base.root,
      packageDir: base.packageDir,
      packageVersion: base.packageVersion,
      environment,
      benchOptions: resolvedBenchOptions,
      commit: base.commit,
      scenarioResults: createOpOnlyOfficialResults(base.scenarios, baseStats),
    });
    const candidateReport = createOfficialReportForRef({
      ref: args.candidateRef,
      sha: candidateSha,
      generatedAt,
      reportPath: args.reportPath,
      artifactRepoRoot: repoRoot,
      worktreeRoot: candidate.root,
      packageDir: candidate.packageDir,
      packageVersion: candidate.packageVersion,
      environment,
      benchOptions: resolvedBenchOptions,
      commit: candidate.commit,
      scenarioResults: createOpOnlyOfficialResults(candidate.scenarios, candidateStats),
    });
    const report = createTrustedRefComparisonReport({
      generatedAt,
      benchOptions: resolvedBenchOptions,
      scenarioOrder,
      baseRef: args.baseRef,
      baseSha,
      basePackageVersion: base.packageVersion,
      baseReport,
      candidateRef: args.candidateRef,
      candidateSha,
      candidatePackageVersion: candidate.packageVersion,
      candidateReport,
      minMeaningfulChangeRatio: args.minMeaningfulChangeRatio,
    });

    await writeJsonReport(args.reportPath, report);
    logger.info("");
    logger.info(formatTrustedRefComparisonSummary(report));
    logger.info("");
    logger.info(`Wrote trusted comparison report: ${path.resolve(args.reportPath)}`);
    return report;
  } finally {
    for (const worktreeRoot of worktrees.reverse()) {
      await removeWorktree(repoRoot, worktreeRoot);
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function runTrustedRefComparisonCli(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  await runTrustedRefComparison(parseTrustedRefComparisonArgs(argv));
}

if (import.meta.main) {
  runTrustedRefComparisonCli().catch((error) => {
    logger.error(error);
    process.exitCode = 1;
  });
}
