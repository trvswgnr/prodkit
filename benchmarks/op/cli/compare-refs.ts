import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
} from "../runtime/comparison-matrix.ts";
import {
  BENCHMARK_PROFILE_DIR,
  benchRunOptionSummary,
  findNewestProfileArtifact,
  getRepoRoot,
  importOpModule,
  importOpPolicyModule,
  parseArgValue,
  parseBenchRunOptions,
  parsePositiveInt,
  readEnvironmentReport,
  readPackageVersion,
  resolveBenchRunOptions,
  resolveOpPackageDir,
  resolveReportPath,
  writeJsonReport,
  runTinybenchRepeatedVariant,
  type BenchRunOptions,
  type EnvironmentReport,
  type RepeatedTinybenchRecord,
  type ResolvedBenchRunOptions,
} from "../runtime/harness.ts";
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
  readBenchmarkCalibrationAttachment,
  readGitCommitMetadata,
  reportArtifactRef,
  type BenchmarkCalibrationAttachment,
  type BenchmarkArtifactRef,
  type BenchmarkCommitMetadata,
  type BenchmarkDiff,
  type OfficialBenchmarkReport,
  type OfficialScenarioResult,
  type ScenarioDiff,
} from "../reports/official-report.ts";
import {
  TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
  TRUSTED_REF_COMPARISON_REPORT_VERSION,
} from "../reports/trusted-ref-comparison-report.ts";
import type {
  RefComparisonSide,
  ScenarioExecutionOrderEntry,
  TrustedRefComparisonProfileArgs,
  TrustedRefComparisonProfileCapture,
  TrustedRefComparisonProfileMode,
  TrustedRefComparisonProfileModeOption,
  TrustedRefComparisonProfileSelection,
  TrustedRefComparisonProfileSelectionSource,
  TrustedRefComparisonReport,
  TrustedRefComparisonSideReport,
  TrustedRefComparisonTargetFingerprint,
} from "../reports/trusted-ref-comparison-report.ts";

export {
  TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
  TRUSTED_REF_COMPARISON_REPORT_VERSION,
} from "../reports/trusted-ref-comparison-report.ts";
export type {
  RefComparisonSide,
  ScenarioExecutionOrderEntry,
  TrustedRefComparisonProfileArgs,
  TrustedRefComparisonProfileCapture,
  TrustedRefComparisonProfileMode,
  TrustedRefComparisonProfileModeOption,
  TrustedRefComparisonProfileSelection,
  TrustedRefComparisonProfileSelectionSource,
  TrustedRefComparisonReport,
  TrustedRefComparisonSideReport,
  TrustedRefComparisonTargetFingerprint,
} from "../reports/trusted-ref-comparison-report.ts";

const logger = console;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export type TrustedRefComparisonCliArgs = {
  baseRef: string;
  candidateRef: string;
  reportPath: string;
  calibrationPath?: string;
  benchOptions: BenchRunOptions;
  minMeaningfulChangeRatio: number;
  profile: TrustedRefComparisonProfileArgs;
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
  targetFingerprint: TrustedRefComparisonTargetFingerprint;
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
  calibration?: BenchmarkCalibrationAttachment;
};

function usage(): string {
  return [
    "usage: node ./op/cli/compare-refs.ts --base=<ref> --candidate=<ref>",
    "  [--report=op/.artifacts/trusted-ref-comparison-report.json]",
    "  [--calibration=op/.artifacts/runner-calibration-report.json]",
    "  [--time=300] [--warmup-time=150] [--warmup-iterations=5] [--repeats=1]",
    "  [--min-change=0.02]",
    "  [--profile-capture=off|auto] [--profile-mode=both|cpu|heap]",
    "  [--profile-scenario=<comparison-key-or-profile-scenario>] [--profile-limit=1]",
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

function parseProfileCapture(value: string | undefined): TrustedRefComparisonProfileCapture {
  if (value === undefined) return "off";
  if (value === "off" || value === "auto") return value;
  throw new Error("Invalid --profile-capture value. Expected off or auto.");
}

function parseProfileMode(value: string | undefined): TrustedRefComparisonProfileModeOption {
  if (value === undefined) return "both";
  if (value === "both" || value === "cpu" || value === "heap") return value;
  throw new Error("Invalid --profile-mode value. Expected both, cpu, or heap.");
}

function parseProfileLimit(value: string | undefined): number {
  if (value === undefined) return 1;
  return parsePositiveInt(value, "profile limit");
}

export function parseTrustedRefComparisonProfileArgs(
  argv: readonly string[],
): TrustedRefComparisonProfileArgs {
  const scenario = parseArgValue(argv, "--profile-scenario=");
  const captureArg = parseArgValue(argv, "--profile-capture=");
  const capture =
    captureArg === undefined && scenario !== undefined ? "auto" : parseProfileCapture(captureArg);
  if (captureArg === "off" && scenario !== undefined) {
    throw new Error("--profile-scenario requires --profile-capture=auto.");
  }
  return {
    capture,
    mode: parseProfileMode(parseArgValue(argv, "--profile-mode=")),
    ...(scenario === undefined ? {} : { scenario }),
    limit: parseProfileLimit(parseArgValue(argv, "--profile-limit=")),
  };
}

export function parseTrustedRefComparisonArgs(
  argv: readonly string[],
): TrustedRefComparisonCliArgs {
  const baseRef = parseArgValue(argv, "--base=");
  const candidateRef = parseArgValue(argv, "--candidate=");
  if (baseRef === undefined || candidateRef === undefined) {
    throw new Error(usage());
  }
  const calibrationPath = parseArgValue(argv, "--calibration=");

  return {
    baseRef,
    candidateRef,
    reportPath: resolveReportPath(argv, "trusted-ref-comparison-report.json"),
    ...(calibrationPath === undefined ? {} : { calibrationPath }),
    benchOptions: parseBenchRunOptions(argv),
    minMeaningfulChangeRatio: parseMinMeaningfulChangeRatio(argv),
    profile: parseTrustedRefComparisonProfileArgs(argv),
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

function profileModes(
  mode: TrustedRefComparisonProfileModeOption,
): TrustedRefComparisonProfileMode[] {
  if (mode === "both") return ["cpu", "heap"];
  return [mode];
}

function profileScenarioTarget(
  scenarios: readonly ComparisonScenario[],
  value: string,
): {
  scenarioKey: string;
  label: string;
  profileScenario: string;
} {
  for (const scenario of scenarios) {
    const opBenchName = scenarioCell(scenario).benchName;
    if (value === scenario.key || value === opBenchName || value === scenario.overheadBench) {
      return {
        scenarioKey: scenario.key,
        label: scenario.label,
        profileScenario: value === scenario.overheadBench ? scenario.overheadBench : opBenchName,
      };
    }
  }

  const available = scenarios
    .flatMap((scenario) => [scenario.key, scenarioCell(scenario).benchName, scenario.overheadBench])
    .join(", ");
  throw new Error(`Unknown profile scenario "${value}". Expected one of: ${available}`);
}

function meaningfulDeltaRank(left: ScenarioDiff, right: ScenarioDiff): number {
  const absoluteDelta = Math.abs(right.deltaRatio) - Math.abs(left.deltaRatio);
  if (absoluteDelta !== 0) return absoluteDelta;
  if (left.verdict === right.verdict) return left.key.localeCompare(right.key);
  return left.verdict === "regression" ? -1 : 1;
}

export function selectTrustedRefComparisonProfileScenarios(input: {
  report: TrustedRefComparisonReport;
  scenarios: readonly ComparisonScenario[];
  profile: TrustedRefComparisonProfileArgs;
}): TrustedRefComparisonProfileSelection[] {
  if (input.profile.capture === "off") return [];

  if (input.profile.scenario !== undefined) {
    const target = profileScenarioTarget(input.scenarios, input.profile.scenario);
    const diff = input.report.diff.scenarios.find(
      (scenario) => scenario.key === target.scenarioKey,
    );
    return [
      {
        source: "manual",
        ...target,
        ...(diff === undefined
          ? {}
          : {
              verdict: diff.verdict,
              deltaRatio: diff.deltaRatio,
            }),
      },
    ];
  }

  return input.report.diff.scenarios
    .filter((scenario) => scenario.verdict !== "inconclusive")
    .sort(meaningfulDeltaRank)
    .slice(0, input.profile.limit)
    .map((scenario) => {
      const target = profileScenarioTarget(input.scenarios, scenario.key);
      return {
        source: "meaningful-delta",
        ...target,
        verdict: scenario.verdict,
        deltaRatio: scenario.deltaRatio,
      };
    });
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
    runner: createRunnerIdentity(input.environment, process.env, input.worktreeRoot),
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
    calibration: input.calibration,
  };
}

export function createTrustedRefComparisonReport(input: {
  generatedAt: string;
  benchOptions: ResolvedBenchRunOptions;
  scenarioOrder: ScenarioExecutionOrderEntry[];
  baseRef: string;
  baseSha: string;
  basePackageVersion: string;
  baseTargetFingerprint: TrustedRefComparisonTargetFingerprint;
  baseReport: OfficialBenchmarkReport;
  candidateRef: string;
  candidateSha: string;
  candidatePackageVersion: string;
  candidateTargetFingerprint: TrustedRefComparisonTargetFingerprint;
  candidateReport: OfficialBenchmarkReport;
  minMeaningfulChangeRatio?: number;
}): TrustedRefComparisonReport {
  const measuredDiff = diffOfficialBenchmarkReports(input.baseReport, input.candidateReport, {
    implementationId: TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
    minMeaningfulChangeRatio: input.minMeaningfulChangeRatio,
  });
  const diff = targetFingerprintsEqual(
    input.baseTargetFingerprint,
    input.candidateTargetFingerprint,
  )
    ? suppressDirectionalVerdicts(measuredDiff)
    : measuredDiff;

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
      targetFingerprint: input.baseTargetFingerprint,
      report: input.baseReport,
    },
    candidate: {
      ref: input.candidateRef,
      sha: input.candidateSha,
      packageVersion: input.candidatePackageVersion,
      targetFingerprint: input.candidateTargetFingerprint,
      report: input.candidateReport,
    },
    diff,
    profile: {
      capture: "off",
      mode: "both",
      limit: 1,
      selections: [],
      artifacts: [],
    },
  };
}

function targetFingerprintsEqual(
  base: TrustedRefComparisonTargetFingerprint,
  candidate: TrustedRefComparisonTargetFingerprint,
): boolean {
  return base.algorithm === candidate.algorithm && base.digest === candidate.digest;
}

function suppressDirectionalVerdicts(diff: BenchmarkDiff): BenchmarkDiff {
  const scenarios: ScenarioDiff[] = diff.scenarios.map((scenario) => ({
    ...scenario,
    verdict: "inconclusive",
  }));
  return {
    ...diff,
    scenarios,
    summary: {
      improvement: 0,
      regression: 0,
      inconclusive: scenarios.length,
    },
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
    ...(targetFingerprintsEqual(report.base.targetFingerprint, report.candidate.targetFingerprint)
      ? ["Target fingerprint: identical; directional verdicts suppressed."]
      : []),
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

function runtimeTargetFingerprintSources(packageDir: string): string[] {
  const distDir = path.join(packageDir, "dist");
  const sources: string[] = [];

  function visit(relativeDir: string): void {
    const absoluteDir = path.join(packageDir, relativeDir);
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        visit(relativePath);
      } else if (entry.isFile() && relativePath.endsWith(".mjs")) {
        sources.push(relativePath.replaceAll(path.sep, "/"));
      }
    }
  }

  visit(path.relative(packageDir, distDir));
  return sources.sort();
}

function createRuntimeTargetFingerprint(packageDir: string): TrustedRefComparisonTargetFingerprint {
  const sources = runtimeTargetFingerprintSources(packageDir);
  if (sources.length === 0) {
    throw new Error(`No built runtime files found under ${path.join(packageDir, "dist")}.`);
  }

  const hash = createHash("sha256");
  for (const source of sources) {
    hash.update(source);
    hash.update("\0");
    hash.update(readFileSync(path.join(packageDir, source)));
    hash.update("\0");
  }

  return {
    algorithm: "sha256",
    digest: hash.digest("hex"),
    sources,
  };
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
  const targetFingerprint = createRuntimeTargetFingerprint(packageDir);
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
    targetFingerprint,
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

function repoRelativeArtifactPath(repoRoot: string, artifactPath: string): string {
  const relative = path.relative(repoRoot, artifactPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return artifactPath.replace(/\\/g, "/");
  }
  return relative.replace(/\\/g, "/");
}

function profileArtifactIsFresh(artifactPath: string, startedAtMs: number): boolean {
  try {
    return statSync(artifactPath).mtimeMs >= startedAtMs - 1_000;
  } catch {
    return false;
  }
}

function profileArtifactKind(
  mode: TrustedRefComparisonProfileMode,
): "cpu-profile" | "heap-profile" {
  return mode === "cpu" ? "cpu-profile" : "heap-profile";
}

function profileArtifactPrefix(mode: TrustedRefComparisonProfileMode): "CPU" | "Heap" {
  return mode === "cpu" ? "CPU" : "Heap";
}

function profileScriptName(mode: TrustedRefComparisonProfileMode): "profile:cpu" | "profile:heap" {
  return mode === "cpu" ? "profile:cpu" : "profile:heap";
}

export type TrustedRefComparisonCapturedProfileArtifact = {
  selection: TrustedRefComparisonProfileSelection;
  mode: TrustedRefComparisonProfileMode;
  artifact: BenchmarkArtifactRef;
};

async function captureTrustedRefComparisonProfiles(input: {
  repoRoot: string;
  packageDir: string;
  profile: TrustedRefComparisonProfileArgs;
  selections: readonly TrustedRefComparisonProfileSelection[];
}): Promise<TrustedRefComparisonCapturedProfileArtifact[]> {
  const captures: TrustedRefComparisonCapturedProfileArtifact[] = [];
  for (const selection of input.selections) {
    for (const mode of profileModes(input.profile.mode)) {
      const startedAt = Date.now();
      logger.info(
        `Capturing ${mode} profile for ${selection.profileScenario} (${selection.source})...`,
      );
      runCommand(
        "pnpm",
        [
          "--filter",
          "@prodkit/benchmarks",
          "run",
          profileScriptName(mode),
          "--",
          `--package-dir=${input.packageDir}`,
          `--scenario=${selection.profileScenario}`,
        ],
        input.repoRoot,
      );

      const artifactPrefix = profileArtifactPrefix(mode);
      const artifactPath = findNewestProfileArtifact(
        path.join(input.repoRoot, "benchmarks", BENCHMARK_PROFILE_DIR),
        artifactPrefix,
      );
      if (artifactPath === undefined || !profileArtifactIsFresh(artifactPath, startedAt)) {
        throw new Error(
          `${artifactPrefix} profile was not written for ${selection.profileScenario}.`,
        );
      }

      captures.push({
        selection,
        mode,
        artifact: {
          kind: profileArtifactKind(mode),
          path: repoRelativeArtifactPath(input.repoRoot, artifactPath),
          contentType: "application/json",
          scenarioKey: selection.scenarioKey,
          implementationId: TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
        },
      });
    }
  }
  return captures;
}

function artifactIdentity(artifact: BenchmarkArtifactRef): string {
  return [
    artifact.kind,
    artifact.path,
    artifact.scenarioKey ?? "",
    artifact.implementationId ?? "",
  ].join("\0");
}

function appendUniqueArtifacts(
  existing: readonly BenchmarkArtifactRef[],
  next: readonly BenchmarkArtifactRef[],
): BenchmarkArtifactRef[] {
  const artifacts = [...existing];
  const seen = new Set(artifacts.map(artifactIdentity));
  for (const artifact of next) {
    const key = artifactIdentity(artifact);
    if (seen.has(key)) continue;
    seen.add(key);
    artifacts.push(artifact);
  }
  return artifacts;
}

export function attachTrustedRefComparisonProfileArtifacts(input: {
  report: TrustedRefComparisonReport;
  profile: TrustedRefComparisonProfileArgs;
  selections: readonly TrustedRefComparisonProfileSelection[];
  captures: readonly TrustedRefComparisonCapturedProfileArtifact[];
}): TrustedRefComparisonReport {
  const capturesByScenario = new Map<string, BenchmarkArtifactRef[]>();
  for (const capture of input.captures) {
    const existing = capturesByScenario.get(capture.selection.scenarioKey) ?? [];
    existing.push(capture.artifact);
    capturesByScenario.set(capture.selection.scenarioKey, existing);
  }

  return {
    ...input.report,
    candidate: {
      ...input.report.candidate,
      report: {
        ...input.report.candidate.report,
        scenarioResults: input.report.candidate.report.scenarioResults.map((scenario) => {
          const artifacts = capturesByScenario.get(scenario.key);
          if (artifacts === undefined) return scenario;
          return {
            ...scenario,
            artifacts: appendUniqueArtifacts(scenario.artifacts, artifacts),
          };
        }),
      },
    },
    profile: {
      capture: input.profile.capture,
      mode: input.profile.mode,
      limit: input.profile.limit,
      ...(input.profile.scenario === undefined ? {} : { scenario: input.profile.scenario }),
      selections: [...input.selections],
      artifacts: input.captures.map((capture) => capture.artifact),
    },
  };
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
  const calibration = await readBenchmarkCalibrationAttachment(repoRoot, args.calibrationPath);
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
      calibration,
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
      calibration,
    });
    const report = createTrustedRefComparisonReport({
      generatedAt,
      benchOptions: resolvedBenchOptions,
      scenarioOrder,
      baseRef: args.baseRef,
      baseSha,
      basePackageVersion: base.packageVersion,
      baseTargetFingerprint: base.targetFingerprint,
      baseReport,
      candidateRef: args.candidateRef,
      candidateSha,
      candidatePackageVersion: candidate.packageVersion,
      candidateTargetFingerprint: candidate.targetFingerprint,
      candidateReport,
      minMeaningfulChangeRatio: args.minMeaningfulChangeRatio,
    });
    const profileSelections = selectTrustedRefComparisonProfileScenarios({
      report,
      scenarios: candidate.scenarios,
      profile: args.profile,
    });
    const profileCaptures = await captureTrustedRefComparisonProfiles({
      repoRoot,
      packageDir: candidate.packageDir,
      profile: args.profile,
      selections: profileSelections,
    });
    const reportWithProfiles = attachTrustedRefComparisonProfileArtifacts({
      report,
      profile: args.profile,
      selections: profileSelections,
      captures: profileCaptures,
    });

    await writeJsonReport(args.reportPath, reportWithProfiles);
    logger.info("");
    logger.info(formatTrustedRefComparisonSummary(reportWithProfiles));
    logger.info("");
    logger.info(`Wrote trusted comparison report: ${path.resolve(args.reportPath)}`);
    return reportWithProfiles;
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
