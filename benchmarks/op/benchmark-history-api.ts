import {
  OFFICIAL_BENCHMARK_REPORT_VERSION,
  validateOfficialBenchmarkReport,
  type BenchmarkArtifactRef,
  type BenchmarkDiff,
  type BenchmarkRunnerIdentity,
  type BenchmarkRunKind,
  type BenchmarkRunIdentity,
  type BenchmarkCommitMetadata,
  type BenchmarkPackageMetadata,
  type OfficialBenchmarkReport,
  type OfficialScenarioResult,
  type ScenarioDiff,
} from "./official-report.ts";
import {
  BENCHMARK_PUBLISH_MANIFEST_VERSION,
  TRUSTED_REF_COMPARISON_REPORT_VERSION,
  type BenchmarkPublishMode,
  type BenchmarkPublishManifest,
  type BenchmarkPublishedArtifact,
} from "./publish-artifacts.ts";
import {
  benchmarkHistoryDashboardResponse,
  isBenchmarkHistoryDashboardRoute,
} from "./benchmark-history-dashboard.ts";

export const BENCHMARK_HISTORY_API_VERSION = "prodkit.benchmark-history-api.v1" as const;

const RUN_INDEX_KEY = "benchmark-history:v1:runs:index";
const COMPARISON_INDEX_KEY = "benchmark-history:v1:comparisons:index";
const MAX_QUERY_LIMIT = 100;
const DEFAULT_QUERY_LIMIT = 20;

type JsonRecord = Record<PropertyKey, unknown>;

export type BenchmarkHistoryKvNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

export type BenchmarkHistoryApiEnv = {
  PRODKIT_BENCHMARK_HISTORY: BenchmarkHistoryKvNamespace;
  PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN?: string;
  PRODKIT_BENCHMARK_ARTIFACT_BASE_URL?: string;
};

export type BenchmarkHistoryArtifact = BenchmarkArtifactRef & {
  objectKey?: string;
  sizeBytes?: number;
  sha256?: string;
};

export type BenchmarkHistoryRunSummary = {
  id: string;
  kind: BenchmarkRunKind;
  generatedAt: string;
  commit: BenchmarkCommitMetadata;
  runner: BenchmarkRunnerIdentity;
  packages: BenchmarkPackageMetadata[];
  scenarioCount: number;
  artifactCount: number;
};

export type BenchmarkHistoryScenarioSample = {
  runId: string;
  runKind: BenchmarkRunKind;
  generatedAt: string;
  commitHeadSha: string;
  runnerId: string;
  key: string;
  label: string;
  group: string;
  implementationId: string;
  implementationLabel: string;
  benchName: string;
  description: string;
  stats: OfficialScenarioResult["stats"];
  artifacts: BenchmarkHistoryArtifact[];
};

export type BenchmarkHistoryRunDetail = BenchmarkHistoryRunSummary & {
  schemaVersion: typeof OFFICIAL_BENCHMARK_REPORT_VERSION;
  run: BenchmarkRunIdentity;
  benchOptions: OfficialBenchmarkReport["benchOptions"];
  dependencyFingerprint: OfficialBenchmarkReport["dependencyFingerprint"];
  environment: OfficialBenchmarkReport["environment"];
  artifacts: BenchmarkHistoryArtifact[];
  scenarios: BenchmarkHistoryScenarioSample[];
  calibration: OfficialBenchmarkReport["calibration"];
};

export type BenchmarkHistoryComparisonSummary = {
  id: string;
  generatedAt: string;
  implementationId: string;
  base: {
    ref: string;
    sha: string;
    runId: string;
  };
  candidate: {
    ref: string;
    sha: string;
    runId: string;
  };
  targetFingerprintChanged?: boolean;
  summary: BenchmarkDiff["summary"];
  scenarios: ScenarioDiff[];
  artifacts: BenchmarkHistoryArtifact[];
};

export type BenchmarkHistoryIndexResult = {
  schemaVersion: typeof BENCHMARK_HISTORY_API_VERSION;
  indexedRunIds: string[];
  indexedComparisonIds: string[];
};

type RunIndexEntry = {
  id: string;
  kind: BenchmarkRunKind;
  generatedAt: string;
};

type ComparisonIndexEntry = {
  id: string;
  generatedAt: string;
};

type TrustedRefComparisonReport = {
  schemaVersion: typeof TRUSTED_REF_COMPARISON_REPORT_VERSION;
  generatedAt: string;
  implementationId: string;
  base: {
    ref: string;
    sha: string;
    targetFingerprint?: TrustedRefComparisonTargetFingerprint;
    report: OfficialBenchmarkReport;
  };
  candidate: {
    ref: string;
    sha: string;
    targetFingerprint?: TrustedRefComparisonTargetFingerprint;
    report: OfficialBenchmarkReport;
  };
  diff: BenchmarkDiff;
};

type TrustedRefComparisonTargetFingerprint = {
  algorithm: string;
  digest: string;
  sources: string[];
};

function isRecord(value: unknown): value is JsonRecord {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

function readRecord(value: unknown, location: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${location}: expected object`);
  }
  return value;
}

function readString(value: unknown, location: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${location}: expected non-empty string`);
  }
  return value;
}

function readNonNegativeNumber(value: unknown, location: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${location}: expected non-negative number`);
  }
  return value;
}

function readFiniteNumber(value: unknown, location: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${location}: expected finite number`);
  }
  return value;
}

function readArtifact(value: unknown, location: string): BenchmarkHistoryArtifact {
  const record = readRecord(value, location);
  const artifact: BenchmarkHistoryArtifact = {
    kind: readString(record.kind, `${location}.kind`),
    path: readString(record.path, `${location}.path`),
    contentType: readString(record.contentType, `${location}.contentType`),
  };
  if (record.objectKey !== undefined) {
    artifact.objectKey = readString(record.objectKey, `${location}.objectKey`);
  }
  if (record.scenarioKey !== undefined) {
    artifact.scenarioKey = readString(record.scenarioKey, `${location}.scenarioKey`);
  }
  if (record.implementationId !== undefined) {
    artifact.implementationId = readString(record.implementationId, `${location}.implementationId`);
  }
  if (record.sizeBytes !== undefined) {
    artifact.sizeBytes = readNonNegativeNumber(record.sizeBytes, `${location}.sizeBytes`);
  }
  if (record.sha256 !== undefined) {
    artifact.sha256 = readString(record.sha256, `${location}.sha256`);
  }
  return artifact;
}

function readArtifactRefs(value: unknown, location: string): BenchmarkArtifactRef[] {
  if (!Array.isArray(value)) {
    throw new Error(`${location}: expected array`);
  }
  return value.map((item, index) => readArtifact(item, `${location}[${index}]`));
}

function readPublishedArtifact(value: unknown, location: string): BenchmarkPublishedArtifact {
  const artifact = readArtifact(value, location);
  if (artifact.objectKey === undefined) {
    throw new Error(`${location}.objectKey: expected non-empty string`);
  }
  if (artifact.sizeBytes === undefined) {
    throw new Error(`${location}.sizeBytes: expected non-negative number`);
  }
  if (artifact.sha256 === undefined) {
    throw new Error(`${location}.sha256: expected non-empty string`);
  }
  const publishedArtifact: BenchmarkPublishedArtifact = {
    ...artifact,
    objectKey: artifact.objectKey,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
  };
  return publishedArtifact;
}

function readPublishMode(value: unknown, location: string): BenchmarkPublishMode {
  const mode = readString(value, location);
  if (mode === "dry-run" || mode === "upload") return mode;
  throw new Error(`${location}: expected dry-run or upload`);
}

function readBenchmarkRunKind(value: unknown, location: string): BenchmarkRunKind {
  const kind = readString(value, location);
  if (kind === "comparison" || kind === "profile") return kind;
  throw new Error(`${location}: expected comparison or profile`);
}

export function validateBenchmarkPublishManifest(input: unknown): BenchmarkPublishManifest {
  const record = readRecord(input, "manifest");
  if (record.schemaVersion !== BENCHMARK_PUBLISH_MANIFEST_VERSION) {
    throw new Error(`manifest.schemaVersion: expected ${BENCHMARK_PUBLISH_MANIFEST_VERSION}`);
  }
  const source = readRecord(record.source, "manifest.source");
  const runIds = source.runIds;
  if (!Array.isArray(runIds)) {
    throw new Error("manifest.source.runIds: expected array");
  }
  const artifacts = record.artifacts;
  if (!Array.isArray(artifacts)) {
    throw new Error("manifest.artifacts: expected array");
  }
  return {
    schemaVersion: BENCHMARK_PUBLISH_MANIFEST_VERSION,
    generatedAt: readString(record.generatedAt, "manifest.generatedAt"),
    mode: readPublishMode(record.mode, "manifest.mode"),
    provider:
      record.provider === "cloudflare-r2"
        ? "cloudflare-r2"
        : (() => {
            throw new Error("manifest.provider: expected cloudflare-r2");
          })(),
    bucket: readString(record.bucket, "manifest.bucket"),
    endpoint: readString(record.endpoint, "manifest.endpoint"),
    ...(record.prefix === undefined
      ? {}
      : { prefix: readString(record.prefix, "manifest.prefix") }),
    source: {
      reportPath: readString(source.reportPath, "manifest.source.reportPath"),
      reportSchemaVersion: readString(
        source.reportSchemaVersion,
        "manifest.source.reportSchemaVersion",
      ),
      runIds: runIds.map((item, index) => readString(item, `manifest.source.runIds[${index}]`)),
    },
    artifacts: artifacts.map((item, index) =>
      readPublishedArtifact(item, `manifest.artifacts[${index}]`),
    ),
  };
}

function readScenarioDiff(value: unknown, location: string): ScenarioDiff {
  const record = readRecord(value, location);
  const verdict = readString(record.verdict, `${location}.verdict`);
  if (verdict !== "improvement" && verdict !== "regression" && verdict !== "inconclusive") {
    throw new Error(`${location}.verdict: expected improvement, regression, or inconclusive`);
  }
  return {
    key: readString(record.key, `${location}.key`),
    label: readString(record.label, `${location}.label`),
    implementationId: readString(record.implementationId, `${location}.implementationId`),
    baseHz: readNonNegativeNumber(record.baseHz, `${location}.baseHz`),
    candidateHz: readNonNegativeNumber(record.candidateHz, `${location}.candidateHz`),
    deltaRatio: readFiniteNumber(record.deltaRatio, `${location}.deltaRatio`),
    combinedNoiseRatio: readNonNegativeNumber(
      record.combinedNoiseRatio,
      `${location}.combinedNoiseRatio`,
    ),
    noiseThresholdRatio: readNonNegativeNumber(
      record.noiseThresholdRatio,
      `${location}.noiseThresholdRatio`,
    ),
    verdict,
  };
}

function readBenchmarkDiff(value: unknown, location: string): BenchmarkDiff {
  const record = readRecord(value, location);
  const summary = readRecord(record.summary, `${location}.summary`);
  const scenarios = record.scenarios;
  if (!Array.isArray(scenarios)) {
    throw new Error(`${location}.scenarios: expected array`);
  }
  return {
    kind: readBenchmarkRunKind(record.kind, `${location}.kind`),
    implementationId: readString(record.implementationId, `${location}.implementationId`),
    baseRun: readBenchmarkRunIdentity(record.baseRun, `${location}.baseRun`),
    candidateRun: readBenchmarkRunIdentity(record.candidateRun, `${location}.candidateRun`),
    scenarios: scenarios.map((item, index) =>
      readScenarioDiff(item, `${location}.scenarios[${index}]`),
    ),
    summary: {
      improvement: readNonNegativeNumber(summary.improvement, `${location}.summary.improvement`),
      regression: readNonNegativeNumber(summary.regression, `${location}.summary.regression`),
      inconclusive: readNonNegativeNumber(summary.inconclusive, `${location}.summary.inconclusive`),
    },
  };
}

function readBenchmarkRunIdentity(value: unknown, location: string): BenchmarkRunIdentity {
  const record = readRecord(value, location);
  return {
    id: readString(record.id, `${location}.id`),
    kind: readBenchmarkRunKind(record.kind, `${location}.kind`),
    generatedAt: readString(record.generatedAt, `${location}.generatedAt`),
    artifacts: readArtifactRefs(record.artifacts, `${location}.artifacts`),
  };
}

function readTrustedRefComparisonTargetFingerprint(
  value: unknown,
  location: string,
): TrustedRefComparisonTargetFingerprint {
  const record = readRecord(value, location);
  const sources = record.sources;
  if (!Array.isArray(sources)) {
    throw new Error(`${location}.sources: expected array`);
  }
  return {
    algorithm: readString(record.algorithm, `${location}.algorithm`),
    digest: readString(record.digest, `${location}.digest`),
    sources: sources.map((item, index) => readString(item, `${location}.sources[${index}]`)),
  };
}

function readTrustedRefComparisonReport(input: unknown): TrustedRefComparisonReport {
  const record = readRecord(input, "report");
  if (record.schemaVersion !== TRUSTED_REF_COMPARISON_REPORT_VERSION) {
    throw new Error(`report.schemaVersion: expected ${TRUSTED_REF_COMPARISON_REPORT_VERSION}`);
  }
  const base = readRecord(record.base, "report.base");
  const candidate = readRecord(record.candidate, "report.candidate");
  return {
    schemaVersion: TRUSTED_REF_COMPARISON_REPORT_VERSION,
    generatedAt: readString(record.generatedAt, "report.generatedAt"),
    implementationId: readString(record.implementationId, "report.implementationId"),
    base: {
      ref: readString(base.ref, "report.base.ref"),
      sha: readString(base.sha, "report.base.sha"),
      ...(base.targetFingerprint === undefined
        ? {}
        : {
            targetFingerprint: readTrustedRefComparisonTargetFingerprint(
              base.targetFingerprint,
              "report.base.targetFingerprint",
            ),
          }),
      report: validateOfficialBenchmarkReport(base.report),
    },
    candidate: {
      ref: readString(candidate.ref, "report.candidate.ref"),
      sha: readString(candidate.sha, "report.candidate.sha"),
      ...(candidate.targetFingerprint === undefined
        ? {}
        : {
            targetFingerprint: readTrustedRefComparisonTargetFingerprint(
              candidate.targetFingerprint,
              "report.candidate.targetFingerprint",
            ),
          }),
      report: validateOfficialBenchmarkReport(candidate.report),
    },
    diff: readBenchmarkDiff(record.diff, "report.diff"),
  };
}

function assertManifestMatchesReport(
  manifest: BenchmarkPublishManifest,
  schemaVersion: string,
  runIds: readonly string[],
): void {
  if (manifest.mode !== "upload") {
    throw new Error("manifest.mode: expected upload manifest from a completed publish");
  }
  if (manifest.source.reportSchemaVersion !== schemaVersion) {
    throw new Error("manifest.source.reportSchemaVersion: does not match report schemaVersion");
  }
  for (const runId of runIds) {
    if (!manifest.source.runIds.includes(runId)) {
      throw new Error(`manifest.source.runIds: missing report run id ${runId}`);
    }
  }
}

function artifactIdentity(
  artifact: Pick<BenchmarkArtifactRef, "kind" | "path" | "scenarioKey" | "implementationId">,
): string {
  return [
    artifact.kind,
    artifact.path,
    artifact.scenarioKey ?? "",
    artifact.implementationId ?? "",
  ].join("\0");
}

function publishedArtifactMap(
  manifest: BenchmarkPublishManifest,
): Map<string, BenchmarkPublishedArtifact> {
  const map = new Map<string, BenchmarkPublishedArtifact>();
  for (const artifact of manifest.artifacts) {
    map.set(artifactIdentity(artifact), artifact);
  }
  return map;
}

function enrichArtifact(
  artifact: BenchmarkArtifactRef,
  publishedArtifacts: Map<string, BenchmarkPublishedArtifact>,
): BenchmarkHistoryArtifact {
  return {
    ...artifact,
    ...publishedArtifacts.get(artifactIdentity(artifact)),
  };
}

function scenarioArtifacts(
  scenario: OfficialScenarioResult,
  publishedArtifacts: Map<string, BenchmarkPublishedArtifact>,
): BenchmarkHistoryArtifact[] {
  return scenario.artifacts.map((artifact) => enrichArtifact(artifact, publishedArtifacts));
}

function runSummary(
  report: OfficialBenchmarkReport,
  artifacts: readonly BenchmarkHistoryArtifact[],
): BenchmarkHistoryRunSummary {
  return {
    id: report.run.id,
    kind: report.run.kind,
    generatedAt: report.run.generatedAt,
    commit: report.commit,
    runner: report.runner,
    packages: report.packages,
    scenarioCount: report.scenarioResults.length,
    artifactCount: artifacts.length,
  };
}

function runScenarios(
  report: OfficialBenchmarkReport,
  publishedArtifacts: Map<string, BenchmarkPublishedArtifact>,
): BenchmarkHistoryScenarioSample[] {
  return report.scenarioResults.map((scenario) => ({
    runId: report.run.id,
    runKind: report.run.kind,
    generatedAt: report.run.generatedAt,
    commitHeadSha: report.commit.headSha,
    runnerId: report.runner.id,
    key: scenario.key,
    label: scenario.label,
    group: scenario.group,
    implementationId: scenario.implementationId,
    implementationLabel: scenario.implementationLabel,
    benchName: scenario.benchName,
    description: scenario.description,
    stats: scenario.stats,
    artifacts: scenarioArtifacts(scenario, publishedArtifacts).filter(
      (artifact) => artifact.objectKey !== undefined,
    ),
  }));
}

function runDetail(
  report: OfficialBenchmarkReport,
  manifest: BenchmarkPublishManifest,
): BenchmarkHistoryRunDetail {
  const publishedArtifacts = publishedArtifactMap(manifest);
  const runArtifacts = report.run.artifacts
    .map((artifact) => enrichArtifact(artifact, publishedArtifacts))
    .filter((artifact) => artifact.objectKey !== undefined);
  const scenarios = runScenarios(report, publishedArtifacts);
  const artifacts = [...runArtifacts, ...scenarios.flatMap((scenario) => scenario.artifacts)];
  return {
    ...runSummary(report, artifacts),
    schemaVersion: OFFICIAL_BENCHMARK_REPORT_VERSION,
    run: report.run,
    benchOptions: report.benchOptions,
    dependencyFingerprint: report.dependencyFingerprint,
    environment: report.environment,
    artifacts,
    scenarios,
    calibration: report.calibration,
  };
}

function comparisonArtifact(
  report: TrustedRefComparisonReport,
  manifest: BenchmarkPublishManifest,
): BenchmarkHistoryArtifact[] {
  const comparisonRunPairKey = `${report.base.report.run.id}__${report.candidate.report.run.id}`;
  const artifact = manifest.artifacts.find(
    (item) =>
      item.kind === "report" &&
      item.objectKey.includes("/trusted-ref-comparison/") &&
      item.objectKey.includes(comparisonRunPairKey),
  );
  return artifact === undefined ? [] : [artifact];
}

function comparisonSummary(
  report: TrustedRefComparisonReport,
  manifest: BenchmarkPublishManifest,
): BenchmarkHistoryComparisonSummary {
  const id = `${report.base.report.run.id}__${report.candidate.report.run.id}`;
  const targetFingerprintChanged =
    report.base.targetFingerprint === undefined || report.candidate.targetFingerprint === undefined
      ? undefined
      : report.base.targetFingerprint.algorithm !== report.candidate.targetFingerprint.algorithm ||
        report.base.targetFingerprint.digest !== report.candidate.targetFingerprint.digest;
  return {
    id,
    generatedAt: report.generatedAt,
    implementationId: report.implementationId,
    base: {
      ref: report.base.ref,
      sha: report.base.sha,
      runId: report.base.report.run.id,
    },
    candidate: {
      ref: report.candidate.ref,
      sha: report.candidate.sha,
      runId: report.candidate.report.run.id,
    },
    ...(targetFingerprintChanged === undefined ? {} : { targetFingerprintChanged }),
    summary: report.diff.summary,
    scenarios: report.diff.scenarios,
    artifacts: comparisonArtifact(report, manifest),
  };
}

function runKey(runId: string): string {
  return `benchmark-history:v1:runs:${encodeURIComponent(runId)}`;
}

function scenarioHistoryKey(scenarioKey: string, implementationId: string): string {
  return `benchmark-history:v1:scenarios:${encodeURIComponent(scenarioKey)}:${encodeURIComponent(
    implementationId,
  )}`;
}

function comparisonKey(comparisonId: string): string {
  return `benchmark-history:v1:comparisons:${encodeURIComponent(comparisonId)}`;
}

function sortNewestFirst<T extends { generatedAt: string }>(items: T[]): T[] {
  return items.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}

async function readJson<T>(kv: BenchmarkHistoryKvNamespace, key: string, fallback: T): Promise<T> {
  const raw = await kv.get(key);
  if (raw === null) return fallback;
  const parsed: T = JSON.parse(raw);
  return parsed;
}

function writeJson(kv: BenchmarkHistoryKvNamespace, key: string, value: unknown): Promise<void> {
  return kv.put(key, JSON.stringify(value));
}

function limitedQueryLimit(value: string | null): number {
  if (value === null) return DEFAULT_QUERY_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_QUERY_LIMIT;
  return Math.min(parsed, MAX_QUERY_LIMIT);
}

export class KvBenchmarkHistoryIndex {
  private readonly kv: BenchmarkHistoryKvNamespace;

  constructor(kv: BenchmarkHistoryKvNamespace) {
    this.kv = kv;
  }

  async upsertRun(detail: BenchmarkHistoryRunDetail): Promise<void> {
    await writeJson(this.kv, runKey(detail.id), detail);
    const index = await readJson<RunIndexEntry[]>(this.kv, RUN_INDEX_KEY, []);
    const next = sortNewestFirst([
      ...index.filter((entry) => entry.id !== detail.id),
      {
        id: detail.id,
        kind: detail.kind,
        generatedAt: detail.generatedAt,
      },
    ]);
    await writeJson(this.kv, RUN_INDEX_KEY, next);

    for (const scenario of detail.scenarios) {
      await this.upsertScenario(scenario);
    }
  }

  async upsertScenario(sample: BenchmarkHistoryScenarioSample): Promise<void> {
    const key = scenarioHistoryKey(sample.key, sample.implementationId);
    const history = await readJson<BenchmarkHistoryScenarioSample[]>(this.kv, key, []);
    const next = sortNewestFirst([
      ...history.filter((item) => item.runId !== sample.runId),
      sample,
    ]);
    await writeJson(this.kv, key, next);
  }

  async upsertComparison(summary: BenchmarkHistoryComparisonSummary): Promise<void> {
    await writeJson(this.kv, comparisonKey(summary.id), summary);
    const index = await readJson<ComparisonIndexEntry[]>(this.kv, COMPARISON_INDEX_KEY, []);
    const next = sortNewestFirst([
      ...index.filter((entry) => entry.id !== summary.id),
      {
        id: summary.id,
        generatedAt: summary.generatedAt,
      },
    ]);
    await writeJson(this.kv, COMPARISON_INDEX_KEY, next);
  }

  async latestRun(kind?: BenchmarkRunKind): Promise<BenchmarkHistoryRunSummary | undefined> {
    const index = await readJson<RunIndexEntry[]>(this.kv, RUN_INDEX_KEY, []);
    const entry = index.find((item) => kind === undefined || item.kind === kind);
    if (entry === undefined) return undefined;
    const detail = await this.runDetail(entry.id);
    if (detail === undefined) return undefined;
    const { artifacts: _artifacts, scenarios: _scenarios, ...summary } = detail;
    return summary;
  }

  async runDetail(runId: string): Promise<BenchmarkHistoryRunDetail | undefined> {
    return readJson<BenchmarkHistoryRunDetail | null>(this.kv, runKey(runId), null).then(
      (value) => value ?? undefined,
    );
  }

  async scenarioHistory(input: {
    scenarioKey: string;
    implementationId: string;
    limit: number;
  }): Promise<BenchmarkHistoryScenarioSample[]> {
    const history = await readJson<BenchmarkHistoryScenarioSample[]>(
      this.kv,
      scenarioHistoryKey(input.scenarioKey, input.implementationId),
      [],
    );
    return history.slice(0, input.limit);
  }

  async comparisonSummaries(limit: number): Promise<BenchmarkHistoryComparisonSummary[]> {
    const index = await readJson<ComparisonIndexEntry[]>(this.kv, COMPARISON_INDEX_KEY, []);
    const summaries: BenchmarkHistoryComparisonSummary[] = [];
    for (const entry of index.slice(0, limit)) {
      const summary = await readJson<BenchmarkHistoryComparisonSummary | null>(
        this.kv,
        comparisonKey(entry.id),
        null,
      );
      if (summary !== null) summaries.push(summary);
    }
    return summaries;
  }
}

export async function indexBenchmarkHistory(input: {
  index: KvBenchmarkHistoryIndex;
  manifest: unknown;
  report: unknown;
}): Promise<BenchmarkHistoryIndexResult> {
  const manifest = validateBenchmarkPublishManifest(input.manifest);
  const reportRecord = readRecord(input.report, "report");
  const schemaVersion = readString(reportRecord.schemaVersion, "report.schemaVersion");

  if (schemaVersion === OFFICIAL_BENCHMARK_REPORT_VERSION) {
    const report = validateOfficialBenchmarkReport(input.report);
    assertManifestMatchesReport(manifest, OFFICIAL_BENCHMARK_REPORT_VERSION, [report.run.id]);
    await input.index.upsertRun(runDetail(report, manifest));
    return {
      schemaVersion: BENCHMARK_HISTORY_API_VERSION,
      indexedRunIds: [report.run.id],
      indexedComparisonIds: [],
    };
  }

  if (schemaVersion === TRUSTED_REF_COMPARISON_REPORT_VERSION) {
    const report = readTrustedRefComparisonReport(input.report);
    assertManifestMatchesReport(manifest, TRUSTED_REF_COMPARISON_REPORT_VERSION, [
      report.base.report.run.id,
      report.candidate.report.run.id,
    ]);
    await input.index.upsertRun(runDetail(report.base.report, manifest));
    await input.index.upsertRun(runDetail(report.candidate.report, manifest));
    const summary = comparisonSummary(report, manifest);
    await input.index.upsertComparison(summary);
    return {
      schemaVersion: BENCHMARK_HISTORY_API_VERSION,
      indexedRunIds: [report.base.report.run.id, report.candidate.report.run.id],
      indexedComparisonIds: [summary.id],
    };
  }

  throw new Error(
    `Unsupported benchmark report schema "${schemaVersion}". Expected ${OFFICIAL_BENCHMARK_REPORT_VERSION} or ${TRUSTED_REF_COMPARISON_REPORT_VERSION}.`,
  );
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value, null, 2) + "\n", {
    ...init,
    headers,
  });
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, { status });
}

function authorizedWrite(request: Request, token: string | undefined): boolean {
  if (token === undefined || token.length === 0) return false;
  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${token}`) return true;
  return request.headers.get("x-prodkit-benchmark-history-token") === token;
}

async function parseIndexRequestBody(request: Request): Promise<{
  manifest: unknown;
  report: unknown;
}> {
  const body = readRecord(await request.json(), "body");
  return {
    manifest: body.manifest,
    report: body.report,
  };
}

function routeSegments(request: Request): string[] {
  return new URL(request.url).pathname.split("/").filter((segment) => segment.length > 0);
}

export async function handleBenchmarkHistoryRequest(
  request: Request,
  env: BenchmarkHistoryApiEnv,
): Promise<Response> {
  const segments = routeSegments(request);
  const index = new KvBenchmarkHistoryIndex(env.PRODKIT_BENCHMARK_HISTORY);
  const url = new URL(request.url);

  try {
    if (request.method === "POST" && segments.join("/") === "api/benchmarks/index") {
      if (!authorizedWrite(request, env.PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN)) {
        return errorResponse(401, "unauthorized benchmark history write");
      }
      const result = await indexBenchmarkHistory({
        index,
        ...(await parseIndexRequestBody(request)),
      });
      return jsonResponse(result, { status: 201 });
    }

    if (request.method === "GET" && segments.join("/") === "api/benchmarks/latest") {
      const kind = url.searchParams.get("kind");
      if (kind !== null && kind !== "comparison" && kind !== "profile") {
        return errorResponse(400, "kind must be comparison or profile");
      }
      const latest = await index.latestRun(kind ?? undefined);
      return latest === undefined
        ? errorResponse(404, "no benchmark runs indexed")
        : jsonResponse(latest);
    }

    if (
      request.method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "benchmarks" &&
      segments[2] === "runs"
    ) {
      const detail = await index.runDetail(decodeURIComponent(segments[3]));
      return detail === undefined
        ? errorResponse(404, "benchmark run not found")
        : jsonResponse(detail);
    }

    if (
      request.method === "GET" &&
      segments.length === 5 &&
      segments[0] === "api" &&
      segments[1] === "benchmarks" &&
      segments[2] === "scenarios" &&
      segments[4] === "history"
    ) {
      const implementationId = url.searchParams.get("implementation") ?? "op";
      const history = await index.scenarioHistory({
        scenarioKey: decodeURIComponent(segments[3]),
        implementationId,
        limit: limitedQueryLimit(url.searchParams.get("limit")),
      });
      return jsonResponse({
        scenarioKey: decodeURIComponent(segments[3]),
        implementationId,
        history,
      });
    }

    if (request.method === "GET" && segments.join("/") === "api/benchmarks/comparisons") {
      const summaries = await index.comparisonSummaries(
        limitedQueryLimit(url.searchParams.get("limit")),
      );
      return jsonResponse({ comparisons: summaries });
    }

    if (isBenchmarkHistoryDashboardRoute(request)) {
      return benchmarkHistoryDashboardResponse(request, {
        artifactBaseUrl: env.PRODKIT_BENCHMARK_ARTIFACT_BASE_URL,
      });
    }

    return errorResponse(404, "benchmark history route not found");
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? 400 : 422, String(error));
  }
}

export default {
  fetch(request: Request, env: BenchmarkHistoryApiEnv): Promise<Response> {
    return handleBenchmarkHistoryRequest(request, env);
  },
};
