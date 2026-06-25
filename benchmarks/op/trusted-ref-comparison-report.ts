import type {
  BenchmarkArtifactRef,
  BenchmarkDiff,
  BenchmarkRunIdentity,
} from "./official-report.ts";
import {
  parseOfficialBenchmarkReport,
  parseArtifactRef,
  type OfficialBenchmarkReport,
} from "./official-report.ts";
import type { ResolvedBenchRunOptions } from "./harness.ts";
import {
  parseError,
  parseFiniteNumber,
  parseNonNegativeNumber,
  parsePositiveInteger,
  parseRecord,
  parseString,
  parseStringArray,
} from "./json-parse.ts";

export const TRUSTED_REF_COMPARISON_REPORT_VERSION = "prodkit.benchmark-ref-comparison.v1" as const;
export const TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID = "op" as const;

export type RefComparisonSide = "base" | "candidate";

export type ScenarioExecutionOrderEntry = {
  scenarioKey: string;
  first: RefComparisonSide;
};

export type TrustedRefComparisonProfileCapture = "off" | "auto";

export type TrustedRefComparisonProfileMode = "cpu" | "heap";

export type TrustedRefComparisonProfileModeOption = TrustedRefComparisonProfileMode | "both";

export type TrustedRefComparisonProfileArgs = {
  capture: TrustedRefComparisonProfileCapture;
  mode: TrustedRefComparisonProfileModeOption;
  scenario?: string;
  limit: number;
};

export type TrustedRefComparisonProfileSelectionSource = "meaningful-delta" | "manual";

export type TrustedRefComparisonProfileSelection = {
  source: TrustedRefComparisonProfileSelectionSource;
  scenarioKey: string;
  label: string;
  profileScenario: string;
  verdict?: BenchmarkDiff["scenarios"][number]["verdict"];
  deltaRatio?: number;
};

export type TrustedRefComparisonTargetFingerprint = {
  algorithm: "sha256";
  digest: string;
  sources: string[];
};

export type TrustedRefComparisonSideReport = {
  ref: string;
  sha: string;
  packageVersion: string;
  targetFingerprint: TrustedRefComparisonTargetFingerprint;
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
  profile: {
    capture: TrustedRefComparisonProfileCapture;
    mode: TrustedRefComparisonProfileModeOption;
    limit: number;
    scenario?: string;
    selections: TrustedRefComparisonProfileSelection[];
    artifacts: BenchmarkArtifactRef[];
  };
};

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

function parseBenchmarkRunKind(value: unknown, location: string): BenchmarkRunIdentity["kind"] {
  const kind = parseString(value, location);
  if (kind === "comparison" || kind === "profile") return kind;
  parseError(location, "expected comparison or profile");
}

function parseBenchmarkRunIdentity(value: unknown, location: string): BenchmarkRunIdentity {
  const record = parseRecord(value, location);
  const artifacts = record.artifacts;
  if (!Array.isArray(artifacts)) {
    parseError(`${location}.artifacts`, "expected array");
  }
  return {
    id: parseString(record.id, `${location}.id`),
    kind: parseBenchmarkRunKind(record.kind, `${location}.kind`),
    generatedAt: parseString(record.generatedAt, `${location}.generatedAt`),
    artifacts: artifacts.map((item, index) =>
      parseArtifactRef(item, `${location}.artifacts[${index}]`),
    ),
  };
}

function parseScenarioDiff(value: unknown, location: string): BenchmarkDiff["scenarios"][number] {
  const record = parseRecord(value, location);
  const verdict = parseString(record.verdict, `${location}.verdict`);
  if (verdict !== "improvement" && verdict !== "regression" && verdict !== "inconclusive") {
    parseError(`${location}.verdict`, "expected improvement, regression, or inconclusive");
  }
  return {
    key: parseString(record.key, `${location}.key`),
    label: parseString(record.label, `${location}.label`),
    implementationId: parseString(record.implementationId, `${location}.implementationId`),
    baseHz: parseNonNegativeNumber(record.baseHz, `${location}.baseHz`),
    candidateHz: parseNonNegativeNumber(record.candidateHz, `${location}.candidateHz`),
    deltaRatio: parseFiniteNumber(record.deltaRatio, `${location}.deltaRatio`),
    combinedNoiseRatio: parseNonNegativeNumber(
      record.combinedNoiseRatio,
      `${location}.combinedNoiseRatio`,
    ),
    noiseThresholdRatio: parseNonNegativeNumber(
      record.noiseThresholdRatio,
      `${location}.noiseThresholdRatio`,
    ),
    verdict,
  };
}

function parseBenchmarkDiff(value: unknown, location: string): BenchmarkDiff {
  const record = parseRecord(value, location);
  const summary = parseRecord(record.summary, `${location}.summary`);
  const scenarios = record.scenarios;
  if (!Array.isArray(scenarios)) {
    parseError(`${location}.scenarios`, "expected array");
  }
  return {
    kind: parseBenchmarkRunKind(record.kind, `${location}.kind`),
    implementationId: parseString(record.implementationId, `${location}.implementationId`),
    baseRun: parseBenchmarkRunIdentity(record.baseRun, `${location}.baseRun`),
    candidateRun: parseBenchmarkRunIdentity(record.candidateRun, `${location}.candidateRun`),
    scenarios: scenarios.map((item, index) =>
      parseScenarioDiff(item, `${location}.scenarios[${index}]`),
    ),
    summary: {
      improvement: parseNonNegativeNumber(summary.improvement, `${location}.summary.improvement`),
      regression: parseNonNegativeNumber(summary.regression, `${location}.summary.regression`),
      inconclusive: parseNonNegativeNumber(
        summary.inconclusive,
        `${location}.summary.inconclusive`,
      ),
    },
  };
}

function parseTrustedRefComparisonTargetFingerprint(
  value: unknown,
  location: string,
): TrustedRefComparisonTargetFingerprint {
  const record = parseRecord(value, location);
  if (record.algorithm !== "sha256") {
    parseError(`${location}.algorithm`, "expected sha256");
  }
  return {
    algorithm: "sha256",
    digest: parseString(record.digest, `${location}.digest`),
    sources: parseStringArray(record.sources, `${location}.sources`),
  };
}

function parseRefComparisonSide(value: unknown, location: string): RefComparisonSide {
  const side = parseString(value, location);
  if (side === "base" || side === "candidate") return side;
  parseError(location, "expected base or candidate");
}

function parseScenarioExecutionOrder(value: unknown): ScenarioExecutionOrderEntry[] {
  if (!Array.isArray(value)) parseError("report.scenarioOrder", "expected array");
  return value.map((item, index) => {
    const location = `report.scenarioOrder[${index}]`;
    const record = parseRecord(item, location);
    return {
      scenarioKey: parseString(record.scenarioKey, `${location}.scenarioKey`),
      first: parseRefComparisonSide(record.first, `${location}.first`),
    };
  });
}

function parseProfileCapture(value: unknown, location: string): TrustedRefComparisonProfileCapture {
  const capture = parseString(value, location);
  if (capture === "off" || capture === "auto") return capture;
  parseError(location, "expected off or auto");
}

function parseProfileMode(value: unknown, location: string): TrustedRefComparisonProfileModeOption {
  const mode = parseString(value, location);
  if (mode === "both" || mode === "cpu" || mode === "heap") return mode;
  parseError(location, "expected both, cpu, or heap");
}

function parseProfileSelectionSource(
  value: unknown,
  location: string,
): TrustedRefComparisonProfileSelectionSource {
  const source = parseString(value, location);
  if (source === "meaningful-delta" || source === "manual") return source;
  parseError(location, "expected meaningful-delta or manual");
}

function parseScenarioVerdict(
  value: unknown,
  location: string,
): BenchmarkDiff["scenarios"][number]["verdict"] {
  const verdict = parseString(value, location);
  if (verdict === "improvement" || verdict === "regression" || verdict === "inconclusive") {
    return verdict;
  }
  parseError(location, "expected improvement, regression, or inconclusive");
}

function parseProfileSelection(
  value: unknown,
  location: string,
): TrustedRefComparisonProfileSelection {
  const record = parseRecord(value, location);
  return {
    source: parseProfileSelectionSource(record.source, `${location}.source`),
    scenarioKey: parseString(record.scenarioKey, `${location}.scenarioKey`),
    label: parseString(record.label, `${location}.label`),
    profileScenario: parseString(record.profileScenario, `${location}.profileScenario`),
    ...(record.verdict === undefined
      ? {}
      : { verdict: parseScenarioVerdict(record.verdict, `${location}.verdict`) }),
    ...(record.deltaRatio === undefined
      ? {}
      : { deltaRatio: parseFiniteNumber(record.deltaRatio, `${location}.deltaRatio`) }),
  };
}

function parseProfileSelections(
  value: unknown,
  location: string,
): TrustedRefComparisonProfileSelection[] {
  if (!Array.isArray(value)) parseError(location, "expected array");
  return value.map((item, index) => parseProfileSelection(item, `${location}[${index}]`));
}

function parseArtifactRefs(value: unknown, location: string): BenchmarkArtifactRef[] {
  if (!Array.isArray(value)) parseError(location, "expected array");
  return value.map((item, index) => parseArtifactRef(item, `${location}[${index}]`));
}

function parseTrustedRefComparisonProfile(value: unknown): TrustedRefComparisonReport["profile"] {
  const record = parseRecord(value, "report.profile");
  return {
    capture: parseProfileCapture(record.capture, "report.profile.capture"),
    mode: parseProfileMode(record.mode, "report.profile.mode"),
    limit: parsePositiveInteger(record.limit, "report.profile.limit"),
    ...(record.scenario === undefined
      ? {}
      : { scenario: parseString(record.scenario, "report.profile.scenario") }),
    selections: parseProfileSelections(record.selections, "report.profile.selections"),
    artifacts: parseArtifactRefs(record.artifacts, "report.profile.artifacts"),
  };
}

function parseTrustedRefComparisonSideReport(
  value: unknown,
  location: string,
): TrustedRefComparisonSideReport {
  const record = parseRecord(value, location);
  return {
    ref: parseString(record.ref, `${location}.ref`),
    sha: parseString(record.sha, `${location}.sha`),
    packageVersion: parseString(record.packageVersion, `${location}.packageVersion`),
    targetFingerprint: parseTrustedRefComparisonTargetFingerprint(
      record.targetFingerprint,
      `${location}.targetFingerprint`,
    ),
    report: parseOfficialBenchmarkReport(record.report),
  };
}

export function parseTrustedRefComparisonReport(input: unknown): TrustedRefComparisonReport {
  const record = parseRecord(input, "report");
  if (record.schemaVersion !== TRUSTED_REF_COMPARISON_REPORT_VERSION) {
    parseError("report.schemaVersion", `expected ${TRUSTED_REF_COMPARISON_REPORT_VERSION}`);
  }
  if (record.implementationId !== TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID) {
    parseError("report.implementationId", `expected ${TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID}`);
  }
  return {
    schemaVersion: TRUSTED_REF_COMPARISON_REPORT_VERSION,
    generatedAt: parseString(record.generatedAt, "report.generatedAt"),
    implementationId: TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
    benchOptions: parseBenchOptions(record.benchOptions, "report.benchOptions"),
    scenarioOrder: parseScenarioExecutionOrder(record.scenarioOrder),
    base: parseTrustedRefComparisonSideReport(record.base, "report.base"),
    candidate: parseTrustedRefComparisonSideReport(record.candidate, "report.candidate"),
    diff: parseBenchmarkDiff(record.diff, "report.diff"),
    profile: parseTrustedRefComparisonProfile(record.profile),
  };
}
