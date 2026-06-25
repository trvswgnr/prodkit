import { describe, expect, it } from "vitest";
import type { ComparisonScenario } from "../runtime/comparison-matrix.ts";
import type { RepeatedTinybenchRecord } from "../runtime/harness.ts";
import {
  OFFICIAL_BENCHMARK_REPORT_VERSION,
  type BenchmarkArtifactRef,
  type BenchmarkRunnerIdentity,
  type OfficialBenchmarkReport,
} from "../reports/official-report.ts";
import {
  TRUSTED_REF_COMPARISON_IMPLEMENTATION_ID,
  TRUSTED_REF_COMPARISON_REPORT_VERSION,
  attachTrustedRefComparisonProfileArtifacts,
  assertCleanGitStatus,
  assertDistinctResolvedRefs,
  createScenarioExecutionOrder,
  createTrustedRefComparisonReport,
  formatTrustedRefComparisonSummary,
  normalizeResolvedGitCommit,
  parseTrustedRefComparisonArgs,
  refComparisonRunOrder,
  selectTrustedRefComparisonProfileScenarios,
  type TrustedRefComparisonCapturedProfileArtifact,
  type TrustedRefComparisonTargetFingerprint,
} from "../cli/compare-refs.ts";

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

function targetFingerprint(digest: string): TrustedRefComparisonTargetFingerprint {
  return {
    algorithm: "sha256",
    digest,
    sources: ["dist/index.mjs"],
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
    runner: runner(),
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

function comparisonScenario(input: {
  key: "singleValue" | "all" | "compose";
  opBenchName: string;
  overheadBench: string;
}): ComparisonScenario {
  return {
    key: input.key,
    label: input.key,
    group: input.key,
    overheadBench: input.overheadBench,
    implementations: {
      native: {
        benchName: `${input.key}.native`,
        description: "native",
        run: () => undefined,
      },
      op: {
        benchName: input.opBenchName,
        description: "op",
        run: () => undefined,
      },
      effect: {
        benchName: `${input.key}.effect`,
        description: "effect",
        run: () => undefined,
      },
    },
  };
}

const comparisonScenarios = [
  comparisonScenario({
    key: "singleValue",
    opBenchName: "singleValue.opRun",
    overheadBench: "overhead.singleValue.ratio",
  }),
  comparisonScenario({
    key: "all",
    opBenchName: "all.opAll",
    overheadBench: "overhead.all.ratio",
  }),
  comparisonScenario({
    key: "compose",
    opBenchName: "compose.opYieldChain",
    overheadBench: "overhead.compose.ratio",
  }),
] as const;

describe("parseTrustedRefComparisonArgs", () => {
  it("requires named base and candidate refs", () => {
    expect(
      parseTrustedRefComparisonArgs([
        "--base=main",
        "--candidate=HEAD",
        "--calibration=op/.artifacts/runner-calibration-report.json",
        "--time=1000",
        "--repeats=3",
        "--min-change=0.05",
        "--profile-capture=auto",
        "--profile-mode=cpu",
        "--profile-limit=2",
      ]),
    ).toEqual({
      baseRef: "main",
      candidateRef: "HEAD",
      reportPath: "op/.artifacts/trusted-ref-comparison-report.json",
      calibrationPath: "op/.artifacts/runner-calibration-report.json",
      benchOptions: {
        time: 1000,
        warmupTime: undefined,
        warmupIterations: undefined,
        repeats: 3,
      },
      minMeaningfulChangeRatio: 0.05,
      profile: {
        capture: "auto",
        mode: "cpu",
        limit: 2,
      },
    });
  });

  it("treats explicit profile scenarios as manual capture requests", () => {
    expect(
      parseTrustedRefComparisonArgs([
        "--base=main",
        "--candidate=HEAD",
        "--profile-scenario=all.opAll",
      ]).profile,
    ).toEqual({
      capture: "auto",
      mode: "both",
      scenario: "all.opAll",
      limit: 1,
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
      baseTargetFingerprint: targetFingerprint("1".repeat(64)),
      baseReport: officialReport({
        runId: "comparison-base",
        sha: "a".repeat(40),
        hz: [100, 100, 100],
      }),
      candidateRef: "HEAD",
      candidateSha: "b".repeat(40),
      candidatePackageVersion: "0.2.2",
      candidateTargetFingerprint: targetFingerprint("2".repeat(64)),
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

  it("suppresses directional verdicts when target fingerprints are identical", () => {
    const unchangedTargetFingerprint = targetFingerprint("1".repeat(64));
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
      baseTargetFingerprint: unchangedTargetFingerprint,
      baseReport: officialReport({
        runId: "comparison-base",
        sha: "a".repeat(40),
        hz: [100, 100, 100],
      }),
      candidateRef: "HEAD",
      candidateSha: "b".repeat(40),
      candidatePackageVersion: "0.2.2",
      candidateTargetFingerprint: unchangedTargetFingerprint,
      candidateReport: officialReport({
        runId: "comparison-candidate",
        sha: "b".repeat(40),
        hz: [120, 80, 101],
      }),
    });

    expect(report.diff.summary).toEqual({
      improvement: 0,
      regression: 0,
      inconclusive: 3,
    });
    expect(report.diff.scenarios.map((scenario) => scenario.verdict)).toEqual([
      "inconclusive",
      "inconclusive",
      "inconclusive",
    ]);
    expect(report.diff.scenarios[0]?.deltaRatio).toBeCloseTo(0.2);
    expect(formatTrustedRefComparisonSummary(report)).toContain(
      "Target fingerprint: identical; directional verdicts suppressed.",
    );
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
      baseTargetFingerprint: targetFingerprint("1".repeat(64)),
      baseReport: officialReport({
        runId: "comparison-base",
        sha: "a".repeat(40),
        hz: [100, 100, 100],
      }),
      candidateRef: "feature",
      candidateSha: "b".repeat(40),
      candidatePackageVersion: "0.2.2",
      candidateTargetFingerprint: targetFingerprint("2".repeat(64)),
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

  it("selects the largest meaningful deltas for automatic profile capture", () => {
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
      baseTargetFingerprint: targetFingerprint("1".repeat(64)),
      baseReport: officialReport({
        runId: "comparison-base",
        sha: "a".repeat(40),
        hz: [100, 100, 100],
      }),
      candidateRef: "HEAD",
      candidateSha: "b".repeat(40),
      candidatePackageVersion: "0.2.2",
      candidateTargetFingerprint: targetFingerprint("2".repeat(64)),
      candidateReport: officialReport({
        runId: "comparison-candidate",
        sha: "b".repeat(40),
        hz: [120, 60, 101],
      }),
    });

    expect(
      selectTrustedRefComparisonProfileScenarios({
        report,
        scenarios: comparisonScenarios,
        profile: {
          capture: "auto",
          mode: "both",
          limit: 1,
        },
      }),
    ).toEqual([
      {
        source: "meaningful-delta",
        scenarioKey: "all",
        label: "all",
        profileScenario: "all.opAll",
        verdict: "regression",
        deltaRatio: -0.4,
      },
    ]);
  });

  it("selects a manual overhead profile scenario by comparison row", () => {
    const report = createTrustedRefComparisonReport({
      generatedAt: "2026-06-23T12:00:00.000Z",
      benchOptions,
      scenarioOrder: [{ scenarioKey: "all", first: "base" }],
      baseRef: "main",
      baseSha: "a".repeat(40),
      basePackageVersion: "0.2.2",
      baseTargetFingerprint: targetFingerprint("1".repeat(64)),
      baseReport: officialReport({
        runId: "comparison-base",
        sha: "a".repeat(40),
        hz: [100, 100, 100],
      }),
      candidateRef: "HEAD",
      candidateSha: "b".repeat(40),
      candidatePackageVersion: "0.2.2",
      candidateTargetFingerprint: targetFingerprint("2".repeat(64)),
      candidateReport: officialReport({
        runId: "comparison-candidate",
        sha: "b".repeat(40),
        hz: [100, 80, 100],
      }),
    });

    expect(
      selectTrustedRefComparisonProfileScenarios({
        report,
        scenarios: comparisonScenarios,
        profile: {
          capture: "auto",
          mode: "cpu",
          scenario: "overhead.all.ratio",
          limit: 1,
        },
      }),
    ).toEqual([
      {
        source: "manual",
        scenarioKey: "all",
        label: "all",
        profileScenario: "overhead.all.ratio",
        verdict: "regression",
        deltaRatio: -0.2,
      },
    ]);
  });

  it("attaches captured profile artifacts to the candidate scenario report", () => {
    const report = createTrustedRefComparisonReport({
      generatedAt: "2026-06-23T12:00:00.000Z",
      benchOptions,
      scenarioOrder: [{ scenarioKey: "all", first: "base" }],
      baseRef: "main",
      baseSha: "a".repeat(40),
      basePackageVersion: "0.2.2",
      baseTargetFingerprint: targetFingerprint("1".repeat(64)),
      baseReport: officialReport({
        runId: "comparison-base",
        sha: "a".repeat(40),
        hz: [100, 100, 100],
      }),
      candidateRef: "HEAD",
      candidateSha: "b".repeat(40),
      candidatePackageVersion: "0.2.2",
      candidateTargetFingerprint: targetFingerprint("2".repeat(64)),
      candidateReport: officialReport({
        runId: "comparison-candidate",
        sha: "b".repeat(40),
        hz: [100, 80, 100],
      }),
    });
    const selection = {
      source: "meaningful-delta",
      scenarioKey: "all",
      label: "all",
      profileScenario: "all.opAll",
      verdict: "regression",
      deltaRatio: -0.2,
    } as const;
    const artifact: BenchmarkArtifactRef = {
      kind: "cpu-profile",
      path: "benchmarks/.profiles/op/CPU.test.cpuprofile",
      contentType: "application/json",
      scenarioKey: "all",
      implementationId: "op",
    };
    const captures: TrustedRefComparisonCapturedProfileArtifact[] = [
      {
        selection,
        mode: "cpu",
        artifact,
      },
    ];

    const withProfiles = attachTrustedRefComparisonProfileArtifacts({
      report,
      profile: {
        capture: "auto",
        mode: "cpu",
        limit: 1,
      },
      selections: [selection],
      captures,
    });

    expect(
      withProfiles.candidate.report.scenarioResults.find((scenario) => scenario.key === "all")
        ?.artifacts,
    ).toEqual([artifact]);
    expect(
      withProfiles.base.report.scenarioResults.find((scenario) => scenario.key === "all")
        ?.artifacts,
    ).toEqual([]);
    expect(withProfiles.profile.artifacts).toEqual([artifact]);
  });
});
