import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cpus, release as osRelease, totalmem, type as osType } from "node:os";
import path from "node:path";
import { isRecordLike } from "@prodkit/shared/runtime";
import type { ImplementationColumn } from "../runtime/comparison-matrix.ts";
import type {
  EnvironmentReport,
  RepeatedTinybenchRecord,
  ResolvedBenchRunOptions,
} from "../runtime/harness.ts";
import {
  parseBoolean,
  parseError,
  parseFiniteNumber,
  parseJsonFile,
  parseNonNegativeNumber,
  parseRecord,
  parseString,
  parseStringArray,
} from "./json-parse.ts";

export const OFFICIAL_BENCHMARK_REPORT_VERSION = "prodkit.benchmark-report.v1" as const;
export const BENCHMARK_CALIBRATION_REPORT_VERSION = "prodkit.benchmark-calibration.v1" as const;
export const DEFAULT_REPORT_DIFF_IMPLEMENTATION_ID = "op";
export const DEFAULT_MIN_MEANINGFUL_CHANGE_RATIO = 0.02;

const DEFAULT_DEPENDENCY_FINGERPRINT_SOURCES = [
  "pnpm-lock.yaml",
  "package.json",
  "pnpm-workspace.yaml",
  "benchmarks/package.json",
  "packages/op/package.json",
  "packages/op-lint/package.json",
  "packages/shared/package.json",
] as const;

const logger = console;

export type BenchmarkRunKind = "comparison" | "profile";

export type BenchmarkArtifactRef = {
  kind: string;
  path: string;
  contentType: string;
  objectKey?: string;
  scenarioKey?: string;
  implementationId?: string;
};

export type BenchmarkRunIdentity = {
  id: string;
  kind: BenchmarkRunKind;
  generatedAt: string;
  artifacts: BenchmarkArtifactRef[];
};

export type BenchmarkCpuMetadata = {
  model: string;
  logicalCores: number;
};

export type BenchmarkMemoryMetadata = {
  totalBytes: number;
};

export type BenchmarkOperatingSystemMetadata = {
  type: string;
  release: string;
  platform: NodeJS.Platform;
  arch: string;
};

export type BenchmarkPackageManagerMetadata = {
  name: string;
  version: string;
};

export type BenchmarkRunnerIdentity = EnvironmentReport & {
  id: string;
  cpu: BenchmarkCpuMetadata;
  memory: BenchmarkMemoryMetadata;
  os: BenchmarkOperatingSystemMetadata;
  packageManager: BenchmarkPackageManagerMetadata;
};

export type BenchmarkCommitMetadata = {
  headSha: string;
  dirty: boolean;
};

export type BenchmarkPackageMetadata = {
  name: string;
  version: string;
  packageDir?: string;
};

export type DependencyFingerprint = {
  algorithm: "sha256";
  digest: string;
  sources: string[];
};

export type OfficialScenarioResult = {
  key: string;
  label: string;
  group: string;
  implementationId: string;
  implementationLabel: string;
  benchName: string;
  description: string;
  stats: RepeatedTinybenchRecord;
  artifacts: BenchmarkArtifactRef[];
};

export type OfficialBenchmarkReport = {
  schemaVersion: typeof OFFICIAL_BENCHMARK_REPORT_VERSION;
  run: BenchmarkRunIdentity;
  runner: BenchmarkRunnerIdentity;
  commit: BenchmarkCommitMetadata;
  packages: BenchmarkPackageMetadata[];
  dependencyFingerprint: DependencyFingerprint;
  environment: EnvironmentReport;
  benchOptions: ResolvedBenchRunOptions;
  scenarioResults: OfficialScenarioResult[];
  calibration?: BenchmarkCalibrationAttachment;
};

export type OfficialReportFieldsInput = {
  kind: BenchmarkRunKind;
  generatedAt: string;
  repoRoot: string;
  reportPath: string;
  environment: EnvironmentReport;
  benchOptions: ResolvedBenchRunOptions;
  commit: BenchmarkCommitMetadata;
  packages: BenchmarkPackageMetadata[];
  scenarioResults: OfficialScenarioResult[];
  calibration?: BenchmarkCalibrationAttachment;
};

export type ComparisonScenarioOfficialInput = {
  key: string;
  label: string;
  implementations: Record<
    string,
    {
      benchName: string;
      description: string;
    }
  >;
  runtime: Record<string, RepeatedTinybenchRecord>;
};

export type ProfileScenarioOfficialInput = RepeatedTinybenchRecord & {
  name: string;
  description: string;
  group: string;
  aliases?: readonly string[];
  artifacts?: readonly BenchmarkArtifactRef[];
};

export type BenchmarkDiffVerdict = "improvement" | "regression" | "inconclusive";

export type ScenarioDiff = {
  key: string;
  label: string;
  implementationId: string;
  baseHz: number;
  candidateHz: number;
  deltaRatio: number;
  combinedNoiseRatio: number;
  noiseThresholdRatio: number;
  verdict: BenchmarkDiffVerdict;
};

export type BenchmarkDiff = {
  kind: BenchmarkRunKind;
  implementationId: string;
  baseRun: BenchmarkRunIdentity;
  candidateRun: BenchmarkRunIdentity;
  scenarios: ScenarioDiff[];
  summary: Record<BenchmarkDiffVerdict, number>;
};

export type BenchmarkCalibrationDecision = "acceptable" | "noisy";

export type BenchmarkCalibrationThresholds = {
  microbenchmarkNoiseRatio: number;
  workflowNoiseRatio: number;
};

export type BenchmarkCalibrationRecommendation = {
  decision: BenchmarkCalibrationDecision;
  thresholdRatio: number;
  worstNoiseBandRatio: number;
  worstScenarioKey: string;
  reason: string;
};

export type BenchmarkCalibrationSampleSummary = {
  sampleIndex: number;
  first: "left" | "right";
  leftHz: number;
  rightHz: number;
  deltaRatio: number;
  absoluteDeltaRatio: number;
  combinedNoiseRatio: number;
};

export type BenchmarkCalibrationScenarioSummary = {
  key: string;
  label: string;
  benchName: string;
  sampleCount: number;
  medianAbsoluteDeltaRatio: number;
  p95AbsoluteDeltaRatio: number;
  maxAbsoluteDeltaRatio: number;
  averageCombinedNoiseRatio: number;
  noiseBandRatio: number;
  samples: BenchmarkCalibrationSampleSummary[];
};

export type BenchmarkCalibrationRecommendations = {
  microbenchmark: BenchmarkCalibrationRecommendation;
  workflow: BenchmarkCalibrationRecommendation;
};

export type BenchmarkCalibrationAttachment = {
  schemaVersion: typeof BENCHMARK_CALIBRATION_REPORT_VERSION;
  generatedAt: string;
  runnerId: string;
  sampleCount: number;
  thresholds: BenchmarkCalibrationThresholds;
  recommendations: BenchmarkCalibrationRecommendations;
  scenarioSummaries: BenchmarkCalibrationScenarioSummary[];
  artifact: BenchmarkArtifactRef;
};

export type BenchmarkCalibrationReport = {
  schemaVersion: typeof BENCHMARK_CALIBRATION_REPORT_VERSION;
  generatedAt: string;
  runner: BenchmarkRunnerIdentity;
  commit: BenchmarkCommitMetadata;
  packages: BenchmarkPackageMetadata[];
  dependencyFingerprint: DependencyFingerprint;
  benchOptions: ResolvedBenchRunOptions;
  sampleCount: number;
  thresholds: BenchmarkCalibrationThresholds;
  recommendations: BenchmarkCalibrationRecommendations;
  scenarioSummaries: BenchmarkCalibrationScenarioSummary[];
};

export class BenchmarkReportCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkReportCompatibilityError";
  }
}

function runGit(repoRoot: string, args: readonly string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

export function readGitCommitMetadata(repoRoot: string): BenchmarkCommitMetadata {
  const headSha = runGit(repoRoot, ["rev-parse", "HEAD"]).toLowerCase();
  if (!headSha.match(/^[0-9a-f]{40}$/)) {
    throw new Error(`Unable to resolve HEAD SHA: ${headSha}`);
  }
  const dirty = runGit(repoRoot, ["status", "--porcelain"]).length > 0;
  return { headSha, dirty };
}

function repoRelativePath(repoRoot: string, candidatePath: string): string {
  const absolutePath = path.resolve(candidatePath);
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return absolutePath;
  return relative;
}

export function createPackageMetadata(
  repoRoot: string,
  name: string,
  version: string,
  packageDir?: string,
): BenchmarkPackageMetadata {
  return {
    name,
    version,
    packageDir: packageDir === undefined ? undefined : repoRelativePath(repoRoot, packageDir),
  };
}

export function createBenchmarkRunId(
  kind: BenchmarkRunKind,
  generatedAt: string,
  commit: BenchmarkCommitMetadata,
): string {
  const timestamp = generatedAt.replace(/\D/g, "").slice(0, 14);
  return `${kind}-${commit.headSha.slice(0, 12)}-${timestamp}`;
}

function parsePackageManagerReference(
  reference: string | undefined,
): BenchmarkPackageManagerMetadata {
  const trimmed = reference?.trim();
  if (!trimmed) return { name: "unknown", version: "unknown" };

  const firstToken = trimmed.split(/\s+/)[0] ?? trimmed;
  const slashIndex = firstToken.indexOf("/");
  if (slashIndex > 0) {
    return {
      name: firstToken.slice(0, slashIndex),
      version: firstToken.slice(slashIndex + 1) || "unknown",
    };
  }

  const atIndex = firstToken.lastIndexOf("@");
  if (atIndex > 0) {
    return {
      name: firstToken.slice(0, atIndex),
      version: firstToken.slice(atIndex + 1) || "unknown",
    };
  }

  return { name: firstToken, version: "unknown" };
}

function readConfiguredPackageManager(repoRoot: string | undefined): string | undefined {
  if (repoRoot === undefined) return undefined;
  try {
    const packageJson: unknown = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    );
    if (!isRecordLike(packageJson)) return undefined;
    return typeof packageJson.packageManager === "string" ? packageJson.packageManager : undefined;
  } catch {
    return undefined;
  }
}

function createCpuMetadata(): BenchmarkCpuMetadata {
  const cpuList = cpus();
  return {
    model: cpuList[0]?.model ?? "unknown",
    logicalCores: cpuList.length,
  };
}

export function createRunnerIdentity(
  environment: EnvironmentReport,
  env: NodeJS.ProcessEnv = process.env,
  repoRoot?: string,
): BenchmarkRunnerIdentity {
  const configuredId = env.PRODKIT_BENCHMARK_RUNNER_ID?.trim();
  const packageManager = parsePackageManagerReference(
    readConfiguredPackageManager(repoRoot) ?? env.npm_config_user_agent,
  );
  return {
    id:
      configuredId && configuredId.length > 0
        ? configuredId
        : `${environment.platform}-${environment.arch}-${environment.node}`,
    ...environment,
    cpu: createCpuMetadata(),
    memory: {
      totalBytes: totalmem(),
    },
    os: {
      type: osType(),
      release: osRelease(),
      platform: environment.platform,
      arch: environment.arch,
    },
    packageManager,
  };
}

export function createDependencyFingerprint(
  repoRoot: string,
  sources: readonly string[] = DEFAULT_DEPENDENCY_FINGERPRINT_SOURCES,
): DependencyFingerprint {
  const hash = createHash("sha256");
  const includedSources: string[] = [];

  for (const source of sources) {
    const sourcePath = path.join(repoRoot, source);
    if (!existsSync(sourcePath)) continue;
    includedSources.push(source);
    hash.update(source);
    hash.update("\0");
    hash.update(readFileSync(sourcePath));
    hash.update("\0");
  }

  if (includedSources.length === 0) {
    hash.update("no dependency fingerprint sources");
  }

  return {
    algorithm: "sha256",
    digest: hash.digest("hex"),
    sources: includedSources,
  };
}

export function reportArtifactRef(repoRoot: string, reportPath: string): BenchmarkArtifactRef {
  return {
    kind: "report",
    path: repoRelativePath(repoRoot, reportPath),
    contentType: "application/json",
  };
}

export function createOfficialBenchmarkReportFields(
  input: OfficialReportFieldsInput,
): OfficialBenchmarkReport {
  const artifact = reportArtifactRef(input.repoRoot, input.reportPath);
  return {
    schemaVersion: OFFICIAL_BENCHMARK_REPORT_VERSION,
    run: {
      id: createBenchmarkRunId(input.kind, input.generatedAt, input.commit),
      kind: input.kind,
      generatedAt: input.generatedAt,
      artifacts: [artifact],
    },
    runner: createRunnerIdentity(input.environment, process.env, input.repoRoot),
    commit: input.commit,
    packages: input.packages,
    dependencyFingerprint: createDependencyFingerprint(input.repoRoot),
    environment: input.environment,
    benchOptions: input.benchOptions,
    scenarioResults: input.scenarioResults,
    calibration: input.calibration,
  };
}

export function comparisonScenariosToOfficialResults(
  scenarios: readonly ComparisonScenarioOfficialInput[],
  implementations: readonly ImplementationColumn[],
): OfficialScenarioResult[] {
  const results: OfficialScenarioResult[] = [];
  for (const scenario of scenarios) {
    for (const column of implementations) {
      const implementation = scenario.implementations[column.id];
      const stats = scenario.runtime[column.id];
      if (implementation === undefined || stats === undefined) {
        throw new Error(
          `Comparison scenario ${scenario.key} is missing implementation ${column.id}.`,
        );
      }
      results.push({
        key: scenario.key,
        label: scenario.label,
        group: "comparison",
        implementationId: column.id,
        implementationLabel: column.header,
        benchName: implementation.benchName,
        description: implementation.description,
        stats,
        artifacts: [],
      });
    }
  }
  return results;
}

function inferProfileImplementationId(name: string): string {
  if (name.startsWith("baseline.") || name === "compose.rawSyncYieldStar") return "native";
  if (name.includes(".effect")) return "effect";
  return "op";
}

export function profileScenariosToOfficialResults(
  scenarios: readonly ProfileScenarioOfficialInput[],
): OfficialScenarioResult[] {
  return scenarios.map((scenario) => {
    const implementationId = inferProfileImplementationId(scenario.name);
    return {
      key: scenario.name,
      label: scenario.name,
      group: scenario.group,
      implementationId,
      implementationLabel: implementationId,
      benchName: scenario.name,
      description: scenario.description,
      stats: {
        hz: scenario.hz,
        latencyMs: scenario.latencyMs,
        latencyMinMs: scenario.latencyMinMs,
        latencyMaxMs: scenario.latencyMaxMs,
        semMs: scenario.semMs,
        rme: scenario.rme,
        sampleCount: scenario.sampleCount,
        repeats: scenario.repeats,
      },
      artifacts: [...(scenario.artifacts ?? [])],
    };
  });
}

export function parseArtifactRef(value: unknown, location: string): BenchmarkArtifactRef {
  const record = parseRecord(value, location);
  const artifact: BenchmarkArtifactRef = {
    kind: parseString(record.kind, `${location}.kind`),
    path: parseString(record.path, `${location}.path`),
    contentType: parseString(record.contentType, `${location}.contentType`),
  };
  if (record.objectKey !== undefined) {
    artifact.objectKey = parseString(record.objectKey, `${location}.objectKey`);
  }
  if (record.scenarioKey !== undefined) {
    artifact.scenarioKey = parseString(record.scenarioKey, `${location}.scenarioKey`);
  }
  if (record.implementationId !== undefined) {
    artifact.implementationId = parseString(
      record.implementationId,
      `${location}.implementationId`,
    );
  }
  return artifact;
}

function parseArtifacts(value: unknown, location: string): BenchmarkArtifactRef[] {
  if (!Array.isArray(value)) parseError(location, "expected array");
  return value.map((item, index) => parseArtifactRef(item, `${location}[${index}]`));
}

function parseBenchOptions(value: unknown, location: string): ResolvedBenchRunOptions {
  const record = parseRecord(value, location);
  return {
    time: parseNonNegativeNumber(record.time, `${location}.time`),
    warmupTime: parseNonNegativeNumber(record.warmupTime, `${location}.warmupTime`),
    warmupIterations: parseNonNegativeNumber(
      record.warmupIterations,
      `${location}.warmupIterations`,
    ),
    repeats: parseNonNegativeNumber(record.repeats, `${location}.repeats`),
  };
}

function parseEnvironment(value: unknown, location: string): EnvironmentReport {
  const record = parseRecord(value, location);
  return {
    node: parseString(record.node, `${location}.node`),
    platform: parsePlatform(record.platform, `${location}.platform`),
    arch: parseString(record.arch, `${location}.arch`),
  };
}

function parseOptionalCpuMetadata(value: unknown, location: string): BenchmarkCpuMetadata {
  if (value === undefined) return { model: "unknown", logicalCores: 0 };
  const record = parseRecord(value, location);
  return {
    model: parseString(record.model, `${location}.model`),
    logicalCores: parseNonNegativeNumber(record.logicalCores, `${location}.logicalCores`),
  };
}

function parseOptionalMemoryMetadata(value: unknown, location: string): BenchmarkMemoryMetadata {
  if (value === undefined) return { totalBytes: 0 };
  const record = parseRecord(value, location);
  return {
    totalBytes: parseNonNegativeNumber(record.totalBytes, `${location}.totalBytes`),
  };
}

function parseOptionalOperatingSystemMetadata(
  value: unknown,
  environment: EnvironmentReport,
  location: string,
): BenchmarkOperatingSystemMetadata {
  if (value === undefined) {
    return {
      type: "unknown",
      release: "unknown",
      platform: environment.platform,
      arch: environment.arch,
    };
  }
  const record = parseRecord(value, location);
  return {
    type: parseString(record.type, `${location}.type`),
    release: parseString(record.release, `${location}.release`),
    platform: parsePlatform(record.platform, `${location}.platform`),
    arch: parseString(record.arch, `${location}.arch`),
  };
}

function parseOptionalPackageManagerMetadata(
  value: unknown,
  location: string,
): BenchmarkPackageManagerMetadata {
  if (value === undefined) return { name: "unknown", version: "unknown" };
  const record = parseRecord(value, location);
  return {
    name: parseString(record.name, `${location}.name`),
    version: parseString(record.version, `${location}.version`),
  };
}

function parseRunnerIdentity(value: unknown, location: string): BenchmarkRunnerIdentity {
  const runnerRecord = parseRecord(value, location);
  const runnerEnvironment = parseEnvironment(runnerRecord, location);
  return {
    id: parseString(runnerRecord.id, `${location}.id`),
    ...runnerEnvironment,
    cpu: parseOptionalCpuMetadata(runnerRecord.cpu, `${location}.cpu`),
    memory: parseOptionalMemoryMetadata(runnerRecord.memory, `${location}.memory`),
    os: parseOptionalOperatingSystemMetadata(runnerRecord.os, runnerEnvironment, `${location}.os`),
    packageManager: parseOptionalPackageManagerMetadata(
      runnerRecord.packageManager,
      `${location}.packageManager`,
    ),
  };
}

function parsePlatform(value: unknown, location: string): NodeJS.Platform {
  const platform = parseString(value, location);
  if (
    platform === "aix" ||
    platform === "android" ||
    platform === "darwin" ||
    platform === "freebsd" ||
    platform === "haiku" ||
    platform === "linux" ||
    platform === "openbsd" ||
    platform === "sunos" ||
    platform === "win32" ||
    platform === "cygwin" ||
    platform === "netbsd"
  ) {
    return platform;
  }
  parseError(location, "expected Node platform id");
}

function parseRepeatedStats(value: unknown, location: string): RepeatedTinybenchRecord {
  const record = parseRecord(value, location);
  const stats: RepeatedTinybenchRecord = {
    hz: parseNonNegativeNumber(record.hz, `${location}.hz`),
    latencyMs: parseNonNegativeNumber(record.latencyMs, `${location}.latencyMs`),
    latencyMinMs: parseNonNegativeNumber(record.latencyMinMs, `${location}.latencyMinMs`),
    latencyMaxMs: parseNonNegativeNumber(record.latencyMaxMs, `${location}.latencyMaxMs`),
    semMs: parseNonNegativeNumber(record.semMs, `${location}.semMs`),
    rme: parseNonNegativeNumber(record.rme, `${location}.rme`),
    sampleCount: parseNonNegativeNumber(record.sampleCount, `${location}.sampleCount`),
  };
  if (record.repeats !== undefined) {
    if (!Array.isArray(record.repeats)) parseError(`${location}.repeats`, "expected array");
    stats.repeats = record.repeats.map((repeat, index) =>
      parseRepeatedStats(repeat, `${location}.repeats[${index}]`),
    );
  }
  return stats;
}

function parseScenarioResult(value: unknown, location: string): OfficialScenarioResult {
  const record = parseRecord(value, location);
  return {
    key: parseString(record.key, `${location}.key`),
    label: parseString(record.label, `${location}.label`),
    group: parseString(record.group, `${location}.group`),
    implementationId: parseString(record.implementationId, `${location}.implementationId`),
    implementationLabel: parseString(record.implementationLabel, `${location}.implementationLabel`),
    benchName: parseString(record.benchName, `${location}.benchName`),
    description: parseString(record.description, `${location}.description`),
    stats: parseRepeatedStats(record.stats, `${location}.stats`),
    artifacts: parseArtifacts(record.artifacts, `${location}.artifacts`),
  };
}

function parsePackages(value: unknown, location: string): BenchmarkPackageMetadata[] {
  if (!Array.isArray(value)) parseError(location, "expected array");
  return value.map((item, index) => {
    const packageRecord = parseRecord(item, `${location}[${index}]`);
    const packageMetadata: BenchmarkPackageMetadata = {
      name: parseString(packageRecord.name, `${location}[${index}].name`),
      version: parseString(packageRecord.version, `${location}[${index}].version`),
    };
    if (packageRecord.packageDir !== undefined) {
      packageMetadata.packageDir = parseString(
        packageRecord.packageDir,
        `${location}[${index}].packageDir`,
      );
    }
    return packageMetadata;
  });
}

function parseDependencyFingerprint(value: unknown, location: string): DependencyFingerprint {
  const fingerprintRecord = parseRecord(value, location);
  return {
    algorithm:
      fingerprintRecord.algorithm === "sha256"
        ? "sha256"
        : parseError(`${location}.algorithm`, "expected sha256"),
    digest: parseString(fingerprintRecord.digest, `${location}.digest`),
    sources: parseStringArray(fingerprintRecord.sources, `${location}.sources`),
  };
}

function parseCalibrationDecision(value: unknown, location: string): BenchmarkCalibrationDecision {
  const decision = parseString(value, location);
  if (decision === "acceptable" || decision === "noisy") return decision;
  parseError(location, "expected acceptable or noisy");
}

function parseCalibrationThresholds(
  value: unknown,
  location: string,
): BenchmarkCalibrationThresholds {
  const record = parseRecord(value, location);
  return {
    microbenchmarkNoiseRatio: parseNonNegativeNumber(
      record.microbenchmarkNoiseRatio,
      `${location}.microbenchmarkNoiseRatio`,
    ),
    workflowNoiseRatio: parseNonNegativeNumber(
      record.workflowNoiseRatio,
      `${location}.workflowNoiseRatio`,
    ),
  };
}

function parseCalibrationRecommendation(
  value: unknown,
  location: string,
): BenchmarkCalibrationRecommendation {
  const record = parseRecord(value, location);
  return {
    decision: parseCalibrationDecision(record.decision, `${location}.decision`),
    thresholdRatio: parseNonNegativeNumber(record.thresholdRatio, `${location}.thresholdRatio`),
    worstNoiseBandRatio: parseNonNegativeNumber(
      record.worstNoiseBandRatio,
      `${location}.worstNoiseBandRatio`,
    ),
    worstScenarioKey: parseString(record.worstScenarioKey, `${location}.worstScenarioKey`),
    reason: parseString(record.reason, `${location}.reason`),
  };
}

function parseCalibrationRecommendations(
  value: unknown,
  location: string,
): BenchmarkCalibrationRecommendations {
  const record = parseRecord(value, location);
  return {
    microbenchmark: parseCalibrationRecommendation(
      record.microbenchmark,
      `${location}.microbenchmark`,
    ),
    workflow: parseCalibrationRecommendation(record.workflow, `${location}.workflow`),
  };
}

function parseCalibrationSampleSummary(
  value: unknown,
  location: string,
): BenchmarkCalibrationSampleSummary {
  const record = parseRecord(value, location);
  const first = parseString(record.first, `${location}.first`);
  if (first !== "left" && first !== "right") {
    parseError(`${location}.first`, "expected left or right");
  }
  return {
    sampleIndex: parseNonNegativeNumber(record.sampleIndex, `${location}.sampleIndex`),
    first,
    leftHz: parseNonNegativeNumber(record.leftHz, `${location}.leftHz`),
    rightHz: parseNonNegativeNumber(record.rightHz, `${location}.rightHz`),
    deltaRatio: parseFiniteNumber(record.deltaRatio, `${location}.deltaRatio`),
    absoluteDeltaRatio: parseNonNegativeNumber(
      record.absoluteDeltaRatio,
      `${location}.absoluteDeltaRatio`,
    ),
    combinedNoiseRatio: parseNonNegativeNumber(
      record.combinedNoiseRatio,
      `${location}.combinedNoiseRatio`,
    ),
  };
}

function parseCalibrationScenarioSummary(
  value: unknown,
  location: string,
): BenchmarkCalibrationScenarioSummary {
  const record = parseRecord(value, location);
  const samples = record.samples;
  if (!Array.isArray(samples)) parseError(`${location}.samples`, "expected array");
  return {
    key: parseString(record.key, `${location}.key`),
    label: parseString(record.label, `${location}.label`),
    benchName: parseString(record.benchName, `${location}.benchName`),
    sampleCount: parseNonNegativeNumber(record.sampleCount, `${location}.sampleCount`),
    medianAbsoluteDeltaRatio: parseNonNegativeNumber(
      record.medianAbsoluteDeltaRatio,
      `${location}.medianAbsoluteDeltaRatio`,
    ),
    p95AbsoluteDeltaRatio: parseNonNegativeNumber(
      record.p95AbsoluteDeltaRatio,
      `${location}.p95AbsoluteDeltaRatio`,
    ),
    maxAbsoluteDeltaRatio: parseNonNegativeNumber(
      record.maxAbsoluteDeltaRatio,
      `${location}.maxAbsoluteDeltaRatio`,
    ),
    averageCombinedNoiseRatio: parseNonNegativeNumber(
      record.averageCombinedNoiseRatio,
      `${location}.averageCombinedNoiseRatio`,
    ),
    noiseBandRatio: parseNonNegativeNumber(record.noiseBandRatio, `${location}.noiseBandRatio`),
    samples: samples.map((sample, index) =>
      parseCalibrationSampleSummary(sample, `${location}.samples[${index}]`),
    ),
  };
}

function parseCalibrationScenarioSummaries(
  value: unknown,
  location: string,
): BenchmarkCalibrationScenarioSummary[] {
  if (!Array.isArray(value)) parseError(location, "expected array");
  if (value.length === 0) parseError(location, "expected at least one scenario summary");
  return value.map((item, index) => parseCalibrationScenarioSummary(item, `${location}[${index}]`));
}

function parseCalibrationAttachment(
  value: unknown,
  location: string,
): BenchmarkCalibrationAttachment {
  const record = parseRecord(value, location);
  if (record.schemaVersion !== BENCHMARK_CALIBRATION_REPORT_VERSION) {
    parseError(`${location}.schemaVersion`, `expected ${BENCHMARK_CALIBRATION_REPORT_VERSION}`);
  }
  return {
    schemaVersion: BENCHMARK_CALIBRATION_REPORT_VERSION,
    generatedAt: parseString(record.generatedAt, `${location}.generatedAt`),
    runnerId: parseString(record.runnerId, `${location}.runnerId`),
    sampleCount: parseNonNegativeNumber(record.sampleCount, `${location}.sampleCount`),
    thresholds: parseCalibrationThresholds(record.thresholds, `${location}.thresholds`),
    recommendations: parseCalibrationRecommendations(
      record.recommendations,
      `${location}.recommendations`,
    ),
    scenarioSummaries: parseCalibrationScenarioSummaries(
      record.scenarioSummaries,
      `${location}.scenarioSummaries`,
    ),
    artifact: parseArtifactRef(record.artifact, `${location}.artifact`),
  };
}

export function parseOfficialBenchmarkReport(input: unknown): OfficialBenchmarkReport {
  const record = parseRecord(input, "report");
  if (record.schemaVersion !== OFFICIAL_BENCHMARK_REPORT_VERSION) {
    parseError("report.schemaVersion", `expected ${OFFICIAL_BENCHMARK_REPORT_VERSION}`);
  }

  const runRecord = parseRecord(record.run, "report.run");
  const kind = parseString(runRecord.kind, "report.run.kind");
  if (kind !== "comparison" && kind !== "profile") {
    parseError("report.run.kind", "expected comparison or profile");
  }

  const commitRecord = parseRecord(record.commit, "report.commit");
  const packages = parsePackages(record.packages, "report.packages");
  const scenarioResults = record.scenarioResults;
  if (!Array.isArray(scenarioResults)) {
    parseError("report.scenarioResults", "expected array");
  }
  if (scenarioResults.length === 0) {
    parseError("report.scenarioResults", "expected at least one scenario result");
  }

  return {
    schemaVersion: OFFICIAL_BENCHMARK_REPORT_VERSION,
    run: {
      id: parseString(runRecord.id, "report.run.id"),
      kind,
      generatedAt: parseString(runRecord.generatedAt, "report.run.generatedAt"),
      artifacts: parseArtifacts(runRecord.artifacts, "report.run.artifacts"),
    },
    runner: parseRunnerIdentity(record.runner, "report.runner"),
    commit: {
      headSha: parseString(commitRecord.headSha, "report.commit.headSha"),
      dirty: parseBoolean(commitRecord.dirty, "report.commit.dirty"),
    },
    packages,
    dependencyFingerprint: parseDependencyFingerprint(
      record.dependencyFingerprint,
      "report.dependencyFingerprint",
    ),
    environment: parseEnvironment(record.environment, "report.environment"),
    benchOptions: parseBenchOptions(record.benchOptions, "report.benchOptions"),
    scenarioResults: scenarioResults.map((item, index) =>
      parseScenarioResult(item, `report.scenarioResults[${index}]`),
    ),
    calibration:
      record.calibration === undefined
        ? undefined
        : parseCalibrationAttachment(record.calibration, "report.calibration"),
  };
}

export function parseBenchmarkCalibrationReport(input: unknown): BenchmarkCalibrationReport {
  const record = parseRecord(input, "calibration");
  if (record.schemaVersion !== BENCHMARK_CALIBRATION_REPORT_VERSION) {
    parseError("calibration.schemaVersion", `expected ${BENCHMARK_CALIBRATION_REPORT_VERSION}`);
  }

  return {
    schemaVersion: BENCHMARK_CALIBRATION_REPORT_VERSION,
    generatedAt: parseString(record.generatedAt, "calibration.generatedAt"),
    runner: parseRunnerIdentity(record.runner, "calibration.runner"),
    commit: (() => {
      const commitRecord = parseRecord(record.commit, "calibration.commit");
      return {
        headSha: parseString(commitRecord.headSha, "calibration.commit.headSha"),
        dirty: parseBoolean(commitRecord.dirty, "calibration.commit.dirty"),
      };
    })(),
    packages: parsePackages(record.packages, "calibration.packages"),
    dependencyFingerprint: parseDependencyFingerprint(
      record.dependencyFingerprint,
      "calibration.dependencyFingerprint",
    ),
    benchOptions: parseBenchOptions(record.benchOptions, "calibration.benchOptions"),
    sampleCount: parseNonNegativeNumber(record.sampleCount, "calibration.sampleCount"),
    thresholds: parseCalibrationThresholds(record.thresholds, "calibration.thresholds"),
    recommendations: parseCalibrationRecommendations(
      record.recommendations,
      "calibration.recommendations",
    ),
    scenarioSummaries: parseCalibrationScenarioSummaries(
      record.scenarioSummaries,
      "calibration.scenarioSummaries",
    ),
  };
}

export async function readBenchmarkCalibrationAttachment(
  repoRoot: string,
  calibrationPath: string | undefined,
): Promise<BenchmarkCalibrationAttachment | undefined> {
  if (calibrationPath === undefined) return undefined;
  const report = parseBenchmarkCalibrationReport(await parseJsonFile(calibrationPath));
  return {
    schemaVersion: BENCHMARK_CALIBRATION_REPORT_VERSION,
    generatedAt: report.generatedAt,
    runnerId: report.runner.id,
    sampleCount: report.sampleCount,
    thresholds: report.thresholds,
    recommendations: report.recommendations,
    scenarioSummaries: report.scenarioSummaries,
    artifact: reportArtifactRef(repoRoot, calibrationPath),
  };
}

function benchOptionsEqual(left: ResolvedBenchRunOptions, right: ResolvedBenchRunOptions): boolean {
  return (
    left.time === right.time &&
    left.warmupTime === right.warmupTime &&
    left.warmupIterations === right.warmupIterations &&
    left.repeats === right.repeats
  );
}

function compatibleError(message: string): never {
  throw new BenchmarkReportCompatibilityError(message);
}

function scenarioKey(result: OfficialScenarioResult): string {
  return `${result.key}\0${result.implementationId}`;
}

function toScenarioMap(
  report: OfficialBenchmarkReport,
  implementationId: string,
): Map<string, OfficialScenarioResult> {
  const map = new Map<string, OfficialScenarioResult>();
  for (const result of report.scenarioResults) {
    if (result.implementationId === implementationId) {
      map.set(scenarioKey(result), result);
    }
  }
  return map;
}

function relativeNoiseRatio(stats: RepeatedTinybenchRecord): number {
  return stats.rme / 100;
}

function calibrationNoiseRatio(
  report: OfficialBenchmarkReport,
  scenario: OfficialScenarioResult,
): number {
  const calibration = report.calibration;
  if (calibration === undefined) return 0;
  const summary = calibration.scenarioSummaries.find(
    (item) => item.key === scenario.key || item.benchName === scenario.benchName,
  );
  return summary?.noiseBandRatio ?? calibration.recommendations.microbenchmark.worstNoiseBandRatio;
}

export function scenarioDiffVerdict(
  baseStats: RepeatedTinybenchRecord,
  candidateStats: RepeatedTinybenchRecord,
  minMeaningfulChangeRatio: number = DEFAULT_MIN_MEANINGFUL_CHANGE_RATIO,
  calibratedNoiseRatio = 0,
): Omit<ScenarioDiff, "key" | "label" | "implementationId"> {
  const deltaRatio =
    baseStats.hz === 0
      ? candidateStats.hz === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : (candidateStats.hz - baseStats.hz) / baseStats.hz;
  const combinedNoiseRatio = Math.hypot(
    relativeNoiseRatio(baseStats),
    relativeNoiseRatio(candidateStats),
  );
  const noiseThresholdRatio = Math.max(
    minMeaningfulChangeRatio,
    combinedNoiseRatio,
    calibratedNoiseRatio,
  );
  const verdict =
    Math.abs(deltaRatio) <= noiseThresholdRatio
      ? "inconclusive"
      : deltaRatio > 0
        ? "improvement"
        : "regression";

  return {
    baseHz: baseStats.hz,
    candidateHz: candidateStats.hz,
    deltaRatio,
    combinedNoiseRatio,
    noiseThresholdRatio,
    verdict,
  };
}

export function diffOfficialBenchmarkReports(
  baseReport: OfficialBenchmarkReport,
  candidateReport: OfficialBenchmarkReport,
  options: {
    implementationId?: string;
    minMeaningfulChangeRatio?: number;
  } = {},
): BenchmarkDiff {
  if (baseReport.schemaVersion !== candidateReport.schemaVersion) {
    compatibleError("report schema versions differ");
  }
  if (baseReport.run.kind !== candidateReport.run.kind) {
    compatibleError("report kinds differ");
  }
  if (!benchOptionsEqual(baseReport.benchOptions, candidateReport.benchOptions)) {
    compatibleError("benchmark options differ");
  }

  const implementationId = options.implementationId ?? DEFAULT_REPORT_DIFF_IMPLEMENTATION_ID;
  const baseScenarios = toScenarioMap(baseReport, implementationId);
  const candidateScenarios = toScenarioMap(candidateReport, implementationId);
  if (baseScenarios.size === 0 || candidateScenarios.size === 0) {
    compatibleError(`no scenario results found for implementation ${implementationId}`);
  }

  const scenarios: ScenarioDiff[] = [];
  for (const [key, baseScenario] of baseScenarios) {
    const candidateScenario = candidateScenarios.get(key);
    if (candidateScenario === undefined) {
      compatibleError(`candidate report is missing scenario ${baseScenario.key}`);
    }
    scenarios.push({
      key: baseScenario.key,
      label: baseScenario.label,
      implementationId,
      ...scenarioDiffVerdict(
        baseScenario.stats,
        candidateScenario.stats,
        options.minMeaningfulChangeRatio,
        Math.max(
          calibrationNoiseRatio(baseReport, baseScenario),
          calibrationNoiseRatio(candidateReport, candidateScenario),
        ),
      ),
    });
  }

  const summary: Record<BenchmarkDiffVerdict, number> = {
    improvement: 0,
    regression: 0,
    inconclusive: 0,
  };
  for (const scenario of scenarios) {
    summary[scenario.verdict] += 1;
  }

  return {
    kind: baseReport.run.kind,
    implementationId,
    baseRun: baseReport.run,
    candidateRun: candidateReport.run,
    scenarios,
    summary,
  };
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatSignedPercent(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const formatted = `${(value * 100).toFixed(2)}%`;
  return value > 0 ? `+${formatted}` : formatted;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatBenchmarkDiff(diff: BenchmarkDiff): string {
  const lines = [
    `Benchmark diff (${diff.kind}, implementation ${diff.implementationId})`,
    `Base: ${diff.baseRun.id}`,
    `Candidate: ${diff.candidateRun.id}`,
    "",
    `${"Scenario".padEnd(32)} ${"Verdict".padEnd(12)} ${"Delta".padStart(10)} ${"Base ops/sec".padStart(14)} ${"Candidate ops/sec".padStart(18)} ${"Threshold".padStart(10)}`,
    `${"-".repeat(32)} ${"-".repeat(12)} ${"-".repeat(10)} ${"-".repeat(14)} ${"-".repeat(18)} ${"-".repeat(10)}`,
  ];

  for (const scenario of diff.scenarios) {
    lines.push(
      `${scenario.label.padEnd(32)} ${scenario.verdict.padEnd(12)} ${formatSignedPercent(
        scenario.deltaRatio,
      ).padStart(10)} ${formatNumber(scenario.baseHz).padStart(14)} ${formatNumber(
        scenario.candidateHz,
      ).padStart(18)} ${formatPercent(scenario.noiseThresholdRatio).padStart(10)}`,
    );
  }

  lines.push("");
  lines.push(
    `Summary: ${diff.summary.improvement} improvements, ${diff.summary.regression} regressions, ${diff.summary.inconclusive} inconclusive`,
  );
  return lines.join("\n");
}

function parseDiffCliArgs(argv: readonly string[]): {
  basePath: string;
  candidatePath: string;
  implementationId: string;
  minMeaningfulChangeRatio: number;
} {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const implementationArg = argv.find((arg) => arg.startsWith("--implementation="));
  const minChangeArg = argv.find((arg) => arg.startsWith("--min-change="));
  const [basePath, candidatePath] = positional;
  if (positional.length !== 2 || basePath === undefined || candidatePath === undefined) {
    throw new Error(
      "usage: node ./op/reports/official-report.ts diff <base-report.json> <candidate-report.json> [--implementation=op] [--min-change=0.02]",
    );
  }
  const implementationId =
    implementationArg === undefined
      ? DEFAULT_REPORT_DIFF_IMPLEMENTATION_ID
      : implementationArg.slice("--implementation=".length);
  if (implementationId.length === 0) {
    throw new Error("Invalid --implementation value. Expected a non-empty id.");
  }
  const minMeaningfulChangeRatio =
    minChangeArg === undefined
      ? DEFAULT_MIN_MEANINGFUL_CHANGE_RATIO
      : Number.parseFloat(minChangeArg.slice("--min-change=".length));
  if (!Number.isFinite(minMeaningfulChangeRatio) || minMeaningfulChangeRatio < 0) {
    throw new Error("Invalid --min-change value. Expected a non-negative ratio.");
  }
  return { basePath, candidatePath, implementationId, minMeaningfulChangeRatio };
}

export async function runOfficialReportCli(argv: readonly string[] = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command !== "diff") {
    throw new Error(
      "usage: node ./op/reports/official-report.ts diff <base-report.json> <candidate-report.json>",
    );
  }

  const args = parseDiffCliArgs(rest);
  const baseReport = parseOfficialBenchmarkReport(await parseJsonFile(args.basePath));
  const candidateReport = parseOfficialBenchmarkReport(await parseJsonFile(args.candidatePath));
  const diff = diffOfficialBenchmarkReports(baseReport, candidateReport, {
    implementationId: args.implementationId,
    minMeaningfulChangeRatio: args.minMeaningfulChangeRatio,
  });
  logger.info(formatBenchmarkDiff(diff));
}

if (import.meta.main) {
  runOfficialReportCli().catch((error) => {
    logger.error(error);
    process.exitCode = 1;
  });
}
