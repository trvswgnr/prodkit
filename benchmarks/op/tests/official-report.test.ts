import { describe, expect, it } from "vitest";
import type { ImplementationColumn } from "../comparison-matrix.ts";
import type { RepeatedTinybenchRecord } from "../harness.ts";
import {
  BenchmarkReportCompatibilityError,
  BenchmarkReportValidationError,
  OFFICIAL_BENCHMARK_REPORT_VERSION,
  comparisonScenariosToOfficialResults,
  diffOfficialBenchmarkReports,
  profileScenariosToOfficialResults,
  scenarioDiffVerdict,
  validateOfficialBenchmarkReport,
  type OfficialBenchmarkReport,
} from "../official-report.ts";

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

function report(
  overrides: {
    kind?: "comparison" | "profile";
    implementationId?: string;
    hz?: number;
    rme?: number;
    benchOptions?: typeof benchOptions;
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
    runner: {
      id: "test-runner",
      node: "v24.14.0",
      platform: "darwin",
      arch: "arm64",
    },
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
  return value;
}

function firstScenario(input: OfficialBenchmarkReport) {
  const [first] = input.scenarioResults;
  if (first === undefined) {
    throw new Error("expected report fixture to contain a scenario");
  }
  return first;
}

describe("official benchmark report validation", () => {
  it("accepts a complete official report", () => {
    expect(validateOfficialBenchmarkReport(report()).run.id).toBe("comparison-run");
  });

  it("rejects unsupported schema versions", () => {
    expect(() =>
      validateOfficialBenchmarkReport({
        ...report(),
        schemaVersion: "prodkit.benchmark-report.v0",
      }),
    ).toThrow(BenchmarkReportValidationError);
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

    expect(() => validateOfficialBenchmarkReport(invalid)).toThrow("stats.hz");
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
