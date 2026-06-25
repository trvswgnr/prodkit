import { describe, expect, it } from "vitest";
import type { ImplementationColumn } from "../runtime/comparison-matrix.ts";
import { getRepoRoot, type RepeatedTinybenchRecord } from "../runtime/harness.ts";
import {
  BENCHMARK_CALIBRATION_REPORT_VERSION,
  BenchmarkReportCompatibilityError,
  OFFICIAL_BENCHMARK_REPORT_VERSION,
  comparisonScenariosToOfficialResults,
  createOfficialBenchmarkReportFields,
  createRunnerIdentity,
  diffOfficialBenchmarkReports,
  parseBenchmarkCalibrationReport,
  parseOfficialBenchmarkReport,
  profileScenariosToOfficialResults,
  scenarioDiffVerdict,
  type BenchmarkCalibrationAttachment,
  type BenchmarkCalibrationReport,
  type BenchmarkRunnerIdentity,
  type OfficialBenchmarkReport,
} from "../reports/official-report.ts";
import { BenchmarkParseError } from "../reports/json-parse.ts";

const benchOptions = {
  time: 300,
  warmupTime: 150,
  warmupIterations: 5,
  repeats: 1,
};

function stats(hz: number, rme = 1): RepeatedTinybenchRecord {
  return {
    hz,
    latencyMs: 1,
    latencyMinMs: 0.9,
    latencyMaxMs: 1.1,
    semMs: 0.01,
    rme,
    sampleCount: 100,
  };
}

function runner(): BenchmarkRunnerIdentity {
  return {
    id: "test-runner",
    node: "v24.14.0",
    platform: "darwin",
    arch: "arm64",
    cpu: {
      model: "test cpu",
      logicalCores: 8,
    },
    memory: {
      totalBytes: 17_179_869_184,
    },
    os: {
      type: "Darwin",
      release: "25.0.0",
      platform: "darwin",
      arch: "arm64",
    },
    packageManager: {
      name: "pnpm",
      version: "11.5.0",
    },
  };
}

function calibrationAttachment(): BenchmarkCalibrationAttachment {
  return {
    schemaVersion: BENCHMARK_CALIBRATION_REPORT_VERSION,
    generatedAt: "2026-06-23T11:00:00.000Z",
    runnerId: "test-runner",
    sampleCount: 3,
    thresholds: {
      microbenchmarkNoiseRatio: 0.05,
      workflowNoiseRatio: 0.1,
    },
    recommendations: {
      microbenchmark: {
        decision: "acceptable",
        thresholdRatio: 0.05,
        worstNoiseBandRatio: 0.02,
        worstScenarioKey: "singleValue",
        reason: "Worst observed noise band 2.00% is within the 5.00% threshold.",
      },
      workflow: {
        decision: "acceptable",
        thresholdRatio: 0.1,
        worstNoiseBandRatio: 0.02,
        worstScenarioKey: "singleValue",
        reason: "Worst observed noise band 2.00% is within the 10.00% threshold.",
      },
    },
    scenarioSummaries: [
      {
        key: "singleValue",
        label: "Single value",
        benchName: "singleValue.opRun",
        sampleCount: 3,
        medianAbsoluteDeltaRatio: 0.01,
        p95AbsoluteDeltaRatio: 0.02,
        maxAbsoluteDeltaRatio: 0.02,
        averageCombinedNoiseRatio: 0.01,
        noiseBandRatio: 0.02,
        samples: [
          {
            sampleIndex: 0,
            first: "left",
            leftHz: 100,
            rightHz: 101,
            deltaRatio: 0.01,
            absoluteDeltaRatio: 0.01,
            combinedNoiseRatio: 0.01,
          },
        ],
      },
    ],
    artifact: {
      kind: "report",
      path: "op/.artifacts/runner-calibration-report.json",
      contentType: "application/json",
    },
  };
}

function calibrationReport(): BenchmarkCalibrationReport {
  const attachment = calibrationAttachment();
  return {
    schemaVersion: BENCHMARK_CALIBRATION_REPORT_VERSION,
    generatedAt: attachment.generatedAt,
    runner: runner(),
    commit: {
      headSha: "a".repeat(40),
      dirty: false,
    },
    packages: [
      {
        name: "@prodkit/op",
        version: "0.2.2",
        packageDir: "packages/op",
      },
    ],
    dependencyFingerprint: {
      algorithm: "sha256",
      digest: "b".repeat(64),
      sources: ["pnpm-lock.yaml"],
    },
    benchOptions,
    sampleCount: attachment.sampleCount,
    thresholds: attachment.thresholds,
    recommendations: attachment.recommendations,
    scenarioSummaries: attachment.scenarioSummaries,
  };
}

function report(
  overrides: {
    kind?: "comparison" | "profile";
    implementationId?: string;
    hz?: number;
    rme?: number;
    benchOptions?: typeof benchOptions;
    calibration?: BenchmarkCalibrationAttachment;
  } = {},
): OfficialBenchmarkReport {
  const value: OfficialBenchmarkReport = {
    schemaVersion: OFFICIAL_BENCHMARK_REPORT_VERSION,
    run: {
      id: `${overrides.kind ?? "comparison"}-run`,
      kind: overrides.kind ?? "comparison",
      generatedAt: "2026-06-23T12:00:00.000Z",
      artifacts: [
        {
          kind: "report",
          path: "op/.artifacts/report.json",
          contentType: "application/json",
        },
      ],
    },
    runner: runner(),
    commit: {
      headSha: "a".repeat(40),
      dirty: false,
    },
    packages: [
      {
        name: "@prodkit/op",
        version: "0.2.2",
        packageDir: "packages/op",
      },
    ],
    dependencyFingerprint: {
      algorithm: "sha256",
      digest: "b".repeat(64),
      sources: ["pnpm-lock.yaml"],
    },
    environment: {
      node: "v24.14.0",
      platform: "darwin",
      arch: "arm64",
    },
    benchOptions: overrides.benchOptions ?? benchOptions,
    scenarioResults: [
      {
        key: "singleValue",
        label: "Single value",
        group: "comparison",
        implementationId: overrides.implementationId ?? "op",
        implementationLabel: "Op",
        benchName: "singleValue.opRun",
        description: "Op.of(x).run()",
        stats: stats(overrides.hz ?? 100, overrides.rme ?? 1),
        artifacts: [],
      },
    ],
  };
  if (overrides.calibration !== undefined) {
    value.calibration = overrides.calibration;
  }
  return value;
}

function firstScenario(input: OfficialBenchmarkReport) {
  const [first] = input.scenarioResults;
  if (first === undefined) {
    throw new Error("expected report fixture to contain a scenario");
  }
  return first;
}

describe("official benchmark report parsing", () => {
  it("accepts a complete official report", () => {
    expect(parseOfficialBenchmarkReport(report()).run.id).toBe("comparison-run");
  });

  it("creates official reports with runner metadata", () => {
    const created = createOfficialBenchmarkReportFields({
      kind: "comparison",
      generatedAt: "2026-06-23T12:00:00.000Z",
      repoRoot: getRepoRoot(),
      reportPath: "op/.artifacts/report.json",
      environment: {
        node: "v24.14.0",
        platform: "darwin",
        arch: "arm64",
      },
      benchOptions,
      commit: {
        headSha: "a".repeat(40),
        dirty: false,
      },
      packages: [
        {
          name: "@prodkit/op",
          version: "0.2.2",
          packageDir: "packages/op",
        },
      ],
      scenarioResults: report().scenarioResults,
      calibration: calibrationAttachment(),
    });

    expect(created.runner.cpu.logicalCores).toBeGreaterThan(0);
    expect(created.runner.memory.totalBytes).toBeGreaterThan(0);
    expect(created.runner.os.release).not.toBe("");
    expect(created.runner.packageManager).toEqual({ name: "pnpm", version: "11.5.0" });
    expect(created.calibration?.runnerId).toBe("test-runner");
  });

  it("derives runner id and package manager from environment fallbacks", () => {
    const created = createRunnerIdentity(
      {
        node: "v24.14.0",
        platform: "darwin",
        arch: "arm64",
      },
      {
        PRODKIT_BENCHMARK_RUNNER_ID: "  official-mac-mini  ",
        npm_config_user_agent: "pnpm/11.5.0 npm/? node/v24.14.0 darwin arm64",
      },
    );

    expect(created.id).toBe("official-mac-mini");
    expect(created.packageManager).toEqual({ name: "pnpm", version: "11.5.0" });
  });

  it("accepts older official reports that do not have expanded runner metadata", () => {
    const legacy = report();
    const parsed = parseOfficialBenchmarkReport({
      ...legacy,
      runner: {
        id: "legacy-runner",
        node: "v24.14.0",
        platform: "darwin",
        arch: "arm64",
      },
    });

    expect(parsed.runner.cpu).toEqual({ model: "unknown", logicalCores: 0 });
    expect(parsed.runner.packageManager).toEqual({ name: "unknown", version: "unknown" });
  });

  it("rejects unsupported schema versions", () => {
    expect(() =>
      parseOfficialBenchmarkReport({
        ...report(),
        schemaVersion: "prodkit.benchmark-report.v0",
      }),
    ).toThrow(BenchmarkParseError);
  });

  it("reports invalid scenario statistics", () => {
    const valid = report();
    const first = firstScenario(valid);
    const invalid = {
      ...valid,
      scenarioResults: [
        {
          ...first,
          stats: {
            ...first.stats,
            hz: "fast",
          },
        },
      ],
    };

    expect(() => parseOfficialBenchmarkReport(invalid)).toThrow("stats.hz");
  });

  it("validates attached runner calibration summaries", () => {
    const parsed = parseOfficialBenchmarkReport({
      ...report(),
      calibration: calibrationAttachment(),
    });

    expect(parsed.calibration?.recommendations.microbenchmark.decision).toBe("acceptable");
  });
});

describe("runner calibration report parsing", () => {
  it("accepts a complete calibration report", () => {
    const parsed = parseBenchmarkCalibrationReport(calibrationReport());

    expect(parsed.schemaVersion).toBe(BENCHMARK_CALIBRATION_REPORT_VERSION);
    expect(parsed.runner.id).toBe("test-runner");
    expect(parsed.recommendations.workflow.decision).toBe("acceptable");
  });

  it("rejects invalid calibration recommendations", () => {
    expect(() =>
      parseBenchmarkCalibrationReport({
        ...calibrationReport(),
        recommendations: {
          ...calibrationReport().recommendations,
          microbenchmark: {
            ...calibrationReport().recommendations.microbenchmark,
            decision: "maybe",
          },
        },
      }),
    ).toThrow(BenchmarkParseError);
  });
});

describe("official report conversion", () => {
  it("converts comparison scenario results without changing scenario keys", () => {
    const columns: ImplementationColumn[] = [
      {
        id: "native",
        header: "Native baseline",
        description: "Native",
      },
      {
        id: "op",
        header: "@prodkit/op",
        description: "Op",
      },
    ];

    const converted = comparisonScenariosToOfficialResults(
      [
        {
          key: "singleValue",
          label: "Single value",
          implementations: {
            native: {
              benchName: "singleValue.rawAsync",
              description: "Promise.resolve(x)",
            },
            op: {
              benchName: "singleValue.opRun",
              description: "Op.of(x).run()",
            },
          },
          runtime: {
            native: stats(200),
            op: stats(100),
          },
        },
      ],
      columns,
    );

    expect(converted.map((item) => [item.key, item.implementationId, item.benchName])).toEqual([
      ["singleValue", "native", "singleValue.rawAsync"],
      ["singleValue", "op", "singleValue.opRun"],
    ]);
  });

  it("converts profile rows to implementation-specific scenario results", () => {
    const converted = profileScenariosToOfficialResults([
      {
        name: "baseline.asyncChain",
        description: "native async chain",
        group: "compose",
        ...stats(1_000),
      },
      {
        name: "compose.yieldChain",
        description: "op yield chain",
        group: "compose",
        ...stats(500),
      },
    ]);

    expect(converted.map((item) => [item.key, item.implementationId])).toEqual([
      ["baseline.asyncChain", "native"],
      ["compose.yieldChain", "op"],
    ]);
  });
});

describe("official report diff verdicts", () => {
  it("treats small deltas inside the noise threshold as inconclusive", () => {
    expect(scenarioDiffVerdict(stats(100, 1), stats(101, 1)).verdict).toBe("inconclusive");
  });

  it("reports meaningful improvements and regressions", () => {
    expect(scenarioDiffVerdict(stats(100, 1), stats(120, 1)).verdict).toBe("improvement");
    expect(scenarioDiffVerdict(stats(100, 1), stats(80, 1)).verdict).toBe("regression");
  });

  it("uses relative margin of error when deciding whether a delta is meaningful", () => {
    const verdict = scenarioDiffVerdict(stats(100, 10), stats(108, 10));
    expect(verdict.verdict).toBe("inconclusive");
    expect(verdict.noiseThresholdRatio).toBeGreaterThan(0.08);
  });

  it("uses attached runner calibration noise when diffing reports", () => {
    const calibration = calibrationAttachment();
    calibration.recommendations = {
      ...calibration.recommendations,
      microbenchmark: {
        ...calibration.recommendations.microbenchmark,
        worstNoiseBandRatio: 0.1,
      },
    };
    calibration.scenarioSummaries = calibration.scenarioSummaries.map((summary) =>
      summary.key === "singleValue" ? { ...summary, noiseBandRatio: 0.1 } : summary,
    );

    const diff = diffOfficialBenchmarkReports(
      report({ hz: 100, calibration }),
      report({ hz: 108, calibration }),
    );

    expect(diff.summary).toEqual({
      improvement: 0,
      regression: 0,
      inconclusive: 1,
    });
    expect(diff.scenarios[0]?.noiseThresholdRatio).toBeCloseTo(0.1);
  });

  it("diffs compatible reports by implementation id", () => {
    const diff = diffOfficialBenchmarkReports(report({ hz: 100 }), report({ hz: 125 }));
    expect(diff.summary).toEqual({
      improvement: 1,
      regression: 0,
      inconclusive: 0,
    });
    expect(diff.scenarios[0]?.deltaRatio).toBeCloseTo(0.25);
  });

  it("rejects incompatible benchmark options", () => {
    expect(() =>
      diffOfficialBenchmarkReports(
        report(),
        report({
          benchOptions: {
            ...benchOptions,
            repeats: 3,
          },
        }),
      ),
    ).toThrow(BenchmarkReportCompatibilityError);
  });
});
