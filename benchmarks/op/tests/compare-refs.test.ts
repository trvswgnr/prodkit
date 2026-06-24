import { describe, expect, it } from "vitest";
import type { RepeatedTinybenchRecord } from "../harness.ts";
import {
  OFFICIAL_BENCHMARK_REPORT_VERSION,
  type OfficialBenchmarkReport,
} from "../official-report.ts";
import {
  TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
  TRUSTED_REF_COMPARISON_REPORT_VERSION,
  assertCleanGitStatus,
  assertDistinctResolvedRefs,
  createScenarioExecutionOrder,
  createTrustedRefComparisonReport,
  formatTrustedRefComparisonSummary,
  normalizeResolvedGitCommit,
  parseTrustedRefComparisonArgs,
  refComparisonRunOrder,
} from "../compare-refs.ts";

const benchOptions = {
  time: 300,
  warmupTime: 150,
  warmupIterations: 5,
  repeats: 1,
};

function stats(hz: number): RepeatedTinybenchRecord {
  return {
    hz,
    latencyMs: 1,
    latencyMinMs: 0.9,
    latencyMaxMs: 1.1,
    semMs: 0.01,
    rme: 1,
    sampleCount: 100,
  };
}

function officialReport(input: {
  runId: string;
  sha: string;
  hz: readonly [number, number, number];
}): OfficialBenchmarkReport {
  const scenarioKeys = ["singleValue", "all", "compose"] as const;
  return {
    schemaVersion: OFFICIAL_BENCHMARK_REPORT_VERSION,
    run: {
      id: input.runId,
      kind: "comparison",
      generatedAt: "2026-06-23T12:00:00.000Z",
      artifacts: [
        {
          kind: "report",
          path: "op/.artifacts/trusted-ref-comparison-report.json",
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
      headSha: input.sha,
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
    benchOptions,
    scenarioResults: scenarioKeys.map((key, index) => ({
      key,
      label: key,
      group: "comparison",
      implementationId: TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
      implementationLabel: "@prodkit/op",
      benchName: `${key}.op`,
      description: `${key} op benchmark`,
      stats: stats(input.hz[index]),
      artifacts: [],
    })),
  };
}

describe("parseTrustedRefComparisonArgs", () => {
  it("requires named base and candidate refs", () => {
    expect(
      parseTrustedRefComparisonArgs([
        "--base=main",
        "--candidate=HEAD",
        "--time=1000",
        "--repeats=3",
        "--min-change=0.05",
      ]),
    ).toEqual({
      baseRef: "main",
      candidateRef: "HEAD",
      reportPath: "op/.artifacts/trusted-ref-comparison-report.json",
      benchOptions: {
        time: 1000,
        warmupTime: undefined,
        warmupIterations: undefined,
        repeats: 3,
      },
      minMeaningfulChangeRatio: 0.05,
    });
  });

  it("rejects missing refs", () => {
    expect(() => parseTrustedRefComparisonArgs(["--base=main"])).toThrow("usage:");
  });
});

describe("ref validation", () => {
  it("normalizes resolved commit refs", () => {
    expect(normalizeResolvedGitCommit("main", `${"A".repeat(40)}\n`)).toBe("a".repeat(40));
  });

  it("rejects refs that do not resolve to commits", () => {
    expect(() => normalizeResolvedGitCommit("main", "not-a-commit")).toThrow(
      'Invalid git ref "main"',
    );
  });

  it("rejects identical base and candidate commits", () => {
    const sha = "a".repeat(40);
    expect(() => assertDistinctResolvedRefs(sha, sha)).toThrow(
      "Base and candidate refs must resolve to different commits.",
    );
  });
});

describe("dirty worktree protection", () => {
  it("accepts a clean git status", () => {
    expect(() => assertCleanGitStatus("")).not.toThrow();
  });

  it("rejects local changes before creating benchmark worktrees", () => {
    expect(() => assertCleanGitStatus(" M packages/op/src/index.ts\n")).toThrow(
      "require a clean working tree",
    );
  });
});

describe("scenario execution order", () => {
  it("alternates which ref runs first", () => {
    expect(refComparisonRunOrder(0)).toEqual(["base", "candidate"]);
    expect(refComparisonRunOrder(1)).toEqual(["candidate", "base"]);
  });

  it("records the first side for each scenario", () => {
    expect(
      createScenarioExecutionOrder([{ key: "singleValue" }, { key: "all" }, { key: "compose" }]),
    ).toEqual([
      { scenarioKey: "singleValue", first: "base" },
      { scenarioKey: "all", first: "candidate" },
      { scenarioKey: "compose", first: "base" },
    ]);
  });
});

describe("trusted ref comparison report", () => {
  it("combines base and candidate reports with an official diff", () => {
    const report = createTrustedRefComparisonReport({
      generatedAt: "2026-06-23T12:00:00.000Z",
      benchOptions,
      scenarioOrder: [
        { scenarioKey: "singleValue", first: "base" },
        { scenarioKey: "all", first: "candidate" },
        { scenarioKey: "compose", first: "base" },
      ],
      baseRef: "main",
      baseSha: "a".repeat(40),
      basePackageVersion: "0.2.2",
      baseReport: officialReport({
        runId: "comparison-base",
        sha: "a".repeat(40),
        hz: [100, 100, 100],
      }),
      candidateRef: "HEAD",
      candidateSha: "b".repeat(40),
      candidatePackageVersion: "0.2.2",
      candidateReport: officialReport({
        runId: "comparison-candidate",
        sha: "b".repeat(40),
        hz: [120, 80, 101],
      }),
    });

    expect(report.schemaVersion).toBe(TRUSTED_REF_COMPARISON_REPORT_VERSION);
    expect(report.base.ref).toBe("main");
    expect(report.candidate.ref).toBe("HEAD");
    expect(report.diff.summary).toEqual({
      improvement: 1,
      regression: 1,
      inconclusive: 1,
    });
  });

  it("prints refs, ordering, and verdict totals", () => {
    const report = createTrustedRefComparisonReport({
      generatedAt: "2026-06-23T12:00:00.000Z",
      benchOptions,
      scenarioOrder: [
        { scenarioKey: "singleValue", first: "base" },
        { scenarioKey: "all", first: "candidate" },
      ],
      baseRef: "main",
      baseSha: "a".repeat(40),
      basePackageVersion: "0.2.2",
      baseReport: officialReport({
        runId: "comparison-base",
        sha: "a".repeat(40),
        hz: [100, 100, 100],
      }),
      candidateRef: "feature",
      candidateSha: "b".repeat(40),
      candidatePackageVersion: "0.2.2",
      candidateReport: officialReport({
        runId: "comparison-candidate",
        sha: "b".repeat(40),
        hz: [120, 80, 101],
      }),
    });

    expect(formatTrustedRefComparisonSummary(report)).toContain("Base: main (aaaaaaaaaaaa)");
    expect(formatTrustedRefComparisonSummary(report)).toContain(
      "Scenario order: alternated by scenario (1 base first, 1 candidate first)",
    );
    expect(formatTrustedRefComparisonSummary(report)).toContain(
      "Summary: 1 improvements, 1 regressions, 1 inconclusive",
    );
  });
});
