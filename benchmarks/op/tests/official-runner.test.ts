import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OFFICIAL_BENCHMARK_RUN_CONTEXT_VERSION,
  assertTrustedRunPolicy,
  createOfficialBenchmarkRunPlan,
  parseOfficialBenchmarkRunCliArgs,
  parseOfficialBenchmarkRunContext,
  publishOfficialBenchmarkRun,
  type OfficialBenchmarkRunArgs,
  type OfficialBenchmarkRunContext,
} from "../cli/official-runner.ts";
import {
  BENCHMARK_PUBLISH_MANIFEST_VERSION,
  type BenchmarkPublishManifest,
} from "../cli/publish-artifacts.ts";
import type { TrustedRefComparisonProfileArgs } from "../cli/compare-refs.ts";

let tempRoots: string[] = [];

afterEach(async () => {
  for (const tempRoot of tempRoots.splice(0)) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function createTempRepo(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "prodkit-official-runner-test-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function profile(
  input: Partial<TrustedRefComparisonProfileArgs> = {},
): TrustedRefComparisonProfileArgs {
  return {
    capture: "off",
    mode: "both",
    limit: 1,
    ...input,
  };
}

function baselineArgs(input: Partial<OfficialBenchmarkRunArgs> = {}): OfficialBenchmarkRunArgs {
  return {
    runKind: "baseline",
    approval: "scheduled-baseline",
    eventName: "schedule",
    baseRef: "main",
    reportPath: "op/.artifacts/comparison-report.json",
    manifestPath: "op/.artifacts/benchmark-publish-manifest.json",
    contextPath: "op/.artifacts/official-benchmark-run-context.json",
    benchOptions: {},
    profile: profile(),
    ...input,
  };
}

function candidateArgs(input: Partial<OfficialBenchmarkRunArgs> = {}): OfficialBenchmarkRunArgs {
  return baselineArgs({
    runKind: "candidate-comparison",
    approval: "manual-candidate-comparison",
    eventName: "workflow_dispatch",
    candidateRef: "feature/perf",
    calibrationPath: "op/.artifacts/runner-calibration-report.json",
    reportPath: "op/.artifacts/trusted-ref-comparison-report.json",
    profile: profile({ capture: "auto" }),
    ...input,
  });
}

function manifest(): BenchmarkPublishManifest {
  return {
    schemaVersion: BENCHMARK_PUBLISH_MANIFEST_VERSION,
    generatedAt: "2026-06-24T12:00:00.000Z",
    mode: "upload",
    provider: "cloudflare-r2",
    bucket: "prodkit-benchmarks",
    endpoint: "https://example-account.r2.cloudflarestorage.com",
    source: {
      reportPath: "op/.artifacts/comparison-report.json",
      reportSchemaVersion: "prodkit.benchmark-report.v1",
      runIds: ["comparison-aaaaaaaaaaaa-20260624120000"],
    },
    artifacts: [
      {
        kind: "report",
        path: "op/.artifacts/comparison-report.json",
        contentType: "application/json",
        objectKey:
          "official/comparison/comparison-aaaaaaaaaaaa-20260624120000/run/report/comparison-report.json",
        sizeBytes: 1000,
        sha256: "a".repeat(64),
      },
    ],
  };
}

function context(input: { reportPath: string; manifestPath: string }): OfficialBenchmarkRunContext {
  return {
    schemaVersion: OFFICIAL_BENCHMARK_RUN_CONTEXT_VERSION,
    generatedAt: "2026-06-24T12:00:00.000Z",
    runKind: "baseline",
    approval: "scheduled-baseline",
    eventName: "schedule",
    baseRef: "main",
    reportPath: input.reportPath,
    manifestPath: input.manifestPath,
    benchArgs: [`--report=${input.reportPath}`],
    profile: profile(),
    policy: {
      automaticBaselineRefs: ["main", "refs/heads/main"],
      candidateApproval: "manual-candidate-comparison",
    },
  };
}

describe("parseOfficialBenchmarkRunCliArgs", () => {
  it("parses a scheduled baseline run", () => {
    expect(
      parseOfficialBenchmarkRunCliArgs([
        "run",
        "--kind=baseline",
        "--approval=scheduled-baseline",
        "--event=schedule",
        "--base=main",
        "--time=1000",
        "--repeats=3",
      ]),
    ).toEqual({
      stage: "run",
      contextPath: "op/.artifacts/official-benchmark-run-context.json",
      run: {
        runKind: "baseline",
        approval: "scheduled-baseline",
        eventName: "schedule",
        baseRef: "main",
        reportPath: "op/.artifacts/comparison-report.json",
        manifestPath: "op/.artifacts/benchmark-publish-manifest.json",
        contextPath: "op/.artifacts/official-benchmark-run-context.json",
        benchOptions: {
          time: 1000,
          warmupTime: undefined,
          warmupIterations: undefined,
          repeats: 3,
        },
        profile: {
          capture: "off",
          mode: "both",
          limit: 1,
        },
      },
    });
  });

  it("accepts a leading pnpm separator before the run stage", () => {
    expect(
      parseOfficialBenchmarkRunCliArgs([
        "--",
        "run",
        "--kind=baseline",
        "--approval=manual-baseline",
        "--event=workflow_dispatch",
        "--base=main",
        "--profile-capture=off",
      ]).run,
    ).toMatchObject({
      runKind: "baseline",
      approval: "manual-baseline",
      eventName: "workflow_dispatch",
      baseRef: "main",
    });
  });

  it("defaults candidate comparisons to automatic profile capture", () => {
    expect(
      parseOfficialBenchmarkRunCliArgs([
        "run",
        "--kind=candidate-comparison",
        "--approval=manual-candidate-comparison",
        "--event=workflow_dispatch",
        "--base=main",
        "--candidate=feature/perf",
        "--profile-scenario=all.opAll",
      ]).run?.profile,
    ).toEqual({
      capture: "auto",
      mode: "both",
      scenario: "all.opAll",
      limit: 1,
    });
  });

  it("parses publish with the default context path", () => {
    expect(parseOfficialBenchmarkRunCliArgs(["publish"])).toEqual({
      stage: "publish",
      contextPath: "op/.artifacts/official-benchmark-run-context.json",
    });
  });

  it("accepts a leading pnpm separator before the publish stage", () => {
    expect(parseOfficialBenchmarkRunCliArgs(["--", "publish"])).toEqual({
      stage: "publish",
      contextPath: "op/.artifacts/official-benchmark-run-context.json",
    });
  });
});

describe("trusted run policy", () => {
  it("allows scheduled baseline runs for main", () => {
    expect(() => assertTrustedRunPolicy(baselineArgs())).not.toThrow();
  });

  it("rejects scheduled baseline runs for non-main refs", () => {
    expect(() => assertTrustedRunPolicy(baselineArgs({ baseRef: "feature/perf" }))).toThrow(
      "Scheduled baseline runs may only target main.",
    );
  });

  it("requires manual approval for candidate comparisons", () => {
    expect(() => assertTrustedRunPolicy(candidateArgs({ approval: "manual-baseline" }))).toThrow(
      "Candidate comparisons require manual-candidate-comparison approval.",
    );
  });

  it("requires calibration for candidate comparisons", () => {
    expect(() => assertTrustedRunPolicy(candidateArgs({ calibrationPath: undefined }))).toThrow(
      "Candidate comparisons require --calibration.",
    );
  });

  it("rejects pull request events", () => {
    expect(() => assertTrustedRunPolicy(candidateArgs({ eventName: "pull_request" }))).toThrow(
      "not allowed from pull request events",
    );
  });
});

describe("official benchmark run plan", () => {
  it("runs baseline reports through the shared compare and publish context path", () => {
    const plan = createOfficialBenchmarkRunPlan(
      baselineArgs({
        benchOptions: {
          time: 1000,
          repeats: 3,
        },
      }),
      new Date("2026-06-24T12:00:00.000Z"),
    );

    expect(plan.commands).toEqual([
      {
        command: "pnpm",
        args: ["--filter", "@prodkit/op", "run", "build"],
      },
      {
        command: "pnpm",
        args: [
          "--filter",
          "@prodkit/benchmarks",
          "run",
          "compare",
          "--",
          "--report=op/.artifacts/comparison-report.json",
          "--time=1000",
          "--repeats=3",
        ],
      },
    ]);
    expect(plan.context).toMatchObject({
      runKind: "baseline",
      approval: "scheduled-baseline",
      reportPath: "op/.artifacts/comparison-report.json",
      manifestPath: "op/.artifacts/benchmark-publish-manifest.json",
    });
  });

  it("runs candidate comparisons through compare:refs with explicit manual approval", () => {
    const plan = createOfficialBenchmarkRunPlan(
      candidateArgs({
        baseRef: "main",
        candidateRef: "feature/perf",
        minMeaningfulChangeRatio: 0.05,
      }),
    );

    expect(plan.commands).toEqual([
      {
        command: "pnpm",
        args: [
          "--filter",
          "@prodkit/benchmarks",
          "run",
          "compare:refs",
          "--",
          "--base=main",
          "--candidate=feature/perf",
          "--report=op/.artifacts/trusted-ref-comparison-report.json",
          "--calibration=op/.artifacts/runner-calibration-report.json",
          "--min-change=0.05",
          "--profile-capture=auto",
          "--profile-mode=both",
          "--profile-limit=1",
        ],
      },
    ]);
    expect(plan.context.policy.candidateApproval).toBe("manual-candidate-comparison");
  });
});

describe("parseOfficialBenchmarkRunContext", () => {
  it("parses the persisted run context", () => {
    const value = context({
      reportPath: "op/.artifacts/comparison-report.json",
      manifestPath: "op/.artifacts/benchmark-publish-manifest.json",
    });

    expect(parseOfficialBenchmarkRunContext(value)).toEqual(value);
  });
});

describe("publishOfficialBenchmarkRun", () => {
  it("publishes the report and posts the uploaded manifest to the history API", async () => {
    const repoRoot = await createTempRepo();
    const reportPath = path.join(repoRoot, "op", ".artifacts", "comparison-report.json");
    const manifestPath = path.join(repoRoot, "op", ".artifacts", "benchmark-publish-manifest.json");
    const contextPath = path.join(
      repoRoot,
      "op",
      ".artifacts",
      "official-benchmark-run-context.json",
    );
    const report = { schemaVersion: "prodkit.benchmark-report.v1", run: { id: "run-id" } };
    const publishedManifest = manifest();
    let posted: { manifest: BenchmarkPublishManifest; report: unknown } | undefined;

    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    await writeFile(
      contextPath,
      JSON.stringify(context({ reportPath, manifestPath }), null, 2) + "\n",
      "utf8",
    );

    await expect(
      publishOfficialBenchmarkRun({
        contextPath,
        repoRoot,
        publishArtifacts: async (input) => {
          expect(input.args).toMatchObject({
            reportPath,
            manifestPath,
            mode: "upload",
          });
          return publishedManifest;
        },
        postHistory: async (input) => {
          posted = input;
        },
      }),
    ).resolves.toBe(publishedManifest);

    expect(posted).toEqual({
      manifest: publishedManifest,
      report,
    });
    await expect(readFile(reportPath, "utf8")).resolves.toContain("run-id");
  });
});
