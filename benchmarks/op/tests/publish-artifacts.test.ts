import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OFFICIAL_BENCHMARK_REPORT_VERSION,
  type BenchmarkDiff,
  type OfficialBenchmarkReport,
} from "../official-report.ts";
import {
  createBenchmarkPublishPlan,
  parsePublishArtifactArg,
  publishBenchmarkArtifacts,
  resolveCloudflareR2PublishTarget,
  type BenchmarkPublishCliArgs,
  type CloudflareR2PublishTarget,
} from "../publish-artifacts.ts";
import { TRUSTED_REF_COMPARISON_REPORT_VERSION } from "../trusted-ref-comparison-report.ts";

const benchOptions = {
  time: 300,
  warmupTime: 150,
  warmupIterations: 5,
  repeats: 1,
};

const target: CloudflareR2PublishTarget = {
  endpoint: "https://example-account.r2.cloudflarestorage.com",
  bucket: "prodkit-benchmarks",
  prefix: "prodkit",
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
};

let tempRoots: string[] = [];

afterEach(async () => {
  for (const tempRoot of tempRoots.splice(0)) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function createTempRepo(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "prodkit-publish-test-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function officialReport(): OfficialBenchmarkReport {
  return {
    schemaVersion: OFFICIAL_BENCHMARK_REPORT_VERSION,
    run: {
      id: "comparison-aaaaaaaaaaaa-20260623120000",
      kind: "comparison",
      generatedAt: "2026-06-23T12:00:00.000Z",
      artifacts: [
        {
          kind: "report",
          path: "op/.artifacts/comparison-report.json",
          contentType: "application/json",
        },
      ],
    },
    runner: {
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
    benchOptions,
    scenarioResults: [
      {
        key: "compose.opYieldChain",
        label: "compose.opYieldChain",
        group: "profile",
        implementationId: "op",
        implementationLabel: "op",
        benchName: "compose.opYieldChain",
        description: "op yield chain",
        stats: {
          hz: 100,
          latencyMs: 1,
          latencyMinMs: 0.9,
          latencyMaxMs: 1.1,
          semMs: 0.01,
          rme: 1,
          sampleCount: 100,
        },
        artifacts: [
          {
            kind: "cpu-profile",
            path: ".profiles/op/CPU.test.cpuprofile",
            contentType: "application/json",
            scenarioKey: "compose.opYieldChain",
            implementationId: "op",
          },
        ],
      },
    ],
  };
}

async function writeOfficialReportFixture(repoRoot: string): Promise<string> {
  const report = officialReport();
  const reportPath = path.join(repoRoot, "op", ".artifacts", "comparison-report.json");
  const profilePath = path.join(repoRoot, ".profiles", "op", "CPU.test.cpuprofile");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(path.dirname(profilePath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  await writeFile(profilePath, JSON.stringify({ cpu: true }) + "\n", "utf8");
  return reportPath;
}

async function writeTrustedRefComparisonReportFixture(repoRoot: string): Promise<string> {
  const baseReport = officialReport();
  const candidateReport: OfficialBenchmarkReport = {
    ...officialReport(),
    run: {
      ...officialReport().run,
      id: "comparison-bbbbbbbbbbbb-20260623120000",
    },
    commit: {
      headSha: "b".repeat(40),
      dirty: false,
    },
  };
  const reportPath = await writeOfficialReportFixture(repoRoot);
  const trustedReportPath = path.join(
    repoRoot,
    "op",
    ".artifacts",
    "trusted-ref-comparison-report.json",
  );
  const diff: BenchmarkDiff = {
    kind: "comparison",
    implementationId: "op",
    baseRun: baseReport.run,
    candidateRun: candidateReport.run,
    scenarios: [
      {
        key: "compose.opYieldChain",
        label: "compose.opYieldChain",
        implementationId: "op",
        baseHz: 100,
        candidateHz: 125,
        deltaRatio: 0.25,
        combinedNoiseRatio: 0.01,
        noiseThresholdRatio: 0.02,
        verdict: "improvement",
      },
    ],
    summary: {
      improvement: 1,
      regression: 0,
      inconclusive: 0,
    },
  };
  const trustedReport = {
    schemaVersion: TRUSTED_REF_COMPARISON_REPORT_VERSION,
    generatedAt: "2026-06-23T12:02:00.000Z",
    implementationId: "op",
    benchOptions,
    scenarioOrder: [{ scenarioKey: "compose.opYieldChain", first: "base" }],
    base: {
      ref: "main",
      sha: baseReport.commit.headSha,
      packageVersion: "0.2.2",
      targetFingerprint: {
        algorithm: "sha256",
        digest: "1".repeat(64),
        sources: ["dist/index.mjs"],
      },
      report: baseReport,
    },
    candidate: {
      ref: "feature/perf",
      sha: candidateReport.commit.headSha,
      packageVersion: "0.2.2",
      targetFingerprint: {
        algorithm: "sha256",
        digest: "2".repeat(64),
        sources: ["dist/index.mjs"],
      },
      report: candidateReport,
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
  await writeFile(trustedReportPath, JSON.stringify(trustedReport, null, 2) + "\n", "utf8");
  await writeFile(reportPath, JSON.stringify(baseReport, null, 2) + "\n", "utf8");
  return trustedReportPath;
}

function publishArgs(
  reportPath: string,
  manifestPath: string,
  mode: "dry-run" | "upload",
): BenchmarkPublishCliArgs {
  return {
    reportPath,
    manifestPath,
    mode,
    extraArtifacts: [],
  };
}

describe("parsePublishArtifactArg", () => {
  it("parses explicit profile metadata", () => {
    expect(
      parsePublishArtifactArg(
        "kind=cpu-profile,path=.profiles/op/CPU.test.cpuprofile,scenario=compose.opYieldChain,implementation=op",
      ),
    ).toEqual({
      kind: "cpu-profile",
      path: ".profiles/op/CPU.test.cpuprofile",
      contentType: "application/json",
      scenarioKey: "compose.opYieldChain",
      implementationId: "op",
    });
  });

  it("infers profile content types and kinds", () => {
    expect(parsePublishArtifactArg("path=.profiles/op/Heap.test.heapprofile")).toEqual({
      kind: "heap-profile",
      path: ".profiles/op/Heap.test.heapprofile",
      contentType: "application/json",
    });
  });
});

describe("resolveCloudflareR2PublishTarget", () => {
  it("does not require credentials for dry-run planning", () => {
    expect(
      resolveCloudflareR2PublishTarget(
        {
          PRODKIT_BENCHMARK_R2_ACCOUNT_ID: "account-id",
          PRODKIT_BENCHMARK_R2_BUCKET: "prodkit-benchmarks",
        },
        { mode: "dry-run" },
      ),
    ).toEqual({
      endpoint: "https://account-id.r2.cloudflarestorage.com",
      bucket: "prodkit-benchmarks",
    });
  });

  it("requires credentials for uploads", () => {
    expect(() =>
      resolveCloudflareR2PublishTarget(
        {
          PRODKIT_BENCHMARK_R2_ACCOUNT_ID: "account-id",
          PRODKIT_BENCHMARK_R2_BUCKET: "prodkit-benchmarks",
        },
        { mode: "upload" },
      ),
    ).toThrow("ACCESS_KEY_ID");
  });
});

describe("createBenchmarkPublishPlan", () => {
  it("derives stable object keys from official run metadata", async () => {
    const repoRoot = await createTempRepo();
    const reportPath = await writeOfficialReportFixture(repoRoot);
    const plan = await createBenchmarkPublishPlan({
      repoRoot,
      reportPath,
      target,
      mode: "dry-run",
      extraArtifacts: [],
      now: new Date("2026-06-24T12:00:00.000Z"),
    });

    expect(plan.manifest.source.runIds).toEqual(["comparison-aaaaaaaaaaaa-20260623120000"]);
    expect(plan.manifest.artifacts.map((artifact) => artifact.objectKey)).toEqual([
      "prodkit/official/comparison/comparison-aaaaaaaaaaaa-20260623120000/run/report/comparison-report.json",
      "prodkit/official/comparison/comparison-aaaaaaaaaaaa-20260623120000/scenario/compose.opYieldChain/op/cpu-profile/CPU.test.cpuprofile",
    ]);
    expect(plan.manifest.artifacts[1]).toMatchObject({
      kind: "cpu-profile",
      contentType: "application/json",
      scenarioKey: "compose.opYieldChain",
      implementationId: "op",
    });
  });

  it("derives a trusted comparison report key from both nested run ids", async () => {
    const repoRoot = await createTempRepo();
    const reportPath = await writeTrustedRefComparisonReportFixture(repoRoot);
    const plan = await createBenchmarkPublishPlan({
      repoRoot,
      reportPath,
      target,
      mode: "dry-run",
      extraArtifacts: [],
      now: new Date("2026-06-24T12:00:00.000Z"),
    });

    expect(plan.manifest.source.runIds).toEqual([
      "comparison-aaaaaaaaaaaa-20260623120000",
      "comparison-bbbbbbbbbbbb-20260623120000",
    ]);
    expect(plan.manifest.artifacts[0]?.objectKey).toBe(
      "prodkit/official/trusted-ref-comparison/comparison-aaaaaaaaaaaa-20260623120000__comparison-bbbbbbbbbbbb-20260623120000/run/report/trusted-ref-comparison-report.json",
    );
  });
});

describe("publishBenchmarkArtifacts", () => {
  it("does not upload or write a manifest in dry-run mode", async () => {
    const repoRoot = await createTempRepo();
    const reportPath = await writeOfficialReportFixture(repoRoot);
    const manifestPath = path.join(repoRoot, "op", ".artifacts", "manifest.json");
    let uploaded = false;

    await publishBenchmarkArtifacts({
      repoRoot,
      target,
      args: publishArgs(reportPath, manifestPath, "dry-run"),
      now: new Date("2026-06-24T12:00:00.000Z"),
      uploadArtifact: async () => {
        uploaded = true;
      },
    });

    expect(uploaded).toBe(false);
    expect(existsSync(manifestPath)).toBe(false);
  });

  it("does not write the manifest when an upload fails", async () => {
    const repoRoot = await createTempRepo();
    const reportPath = await writeOfficialReportFixture(repoRoot);
    const manifestPath = path.join(repoRoot, "op", ".artifacts", "manifest.json");

    await expect(
      publishBenchmarkArtifacts({
        repoRoot,
        target,
        args: publishArgs(reportPath, manifestPath, "upload"),
        now: new Date("2026-06-24T12:00:00.000Z"),
        uploadArtifact: async () => {
          throw new Error("upload failed");
        },
      }),
    ).rejects.toThrow("upload failed");

    expect(existsSync(manifestPath)).toBe(false);
  });

  it("writes the manifest after successful uploads", async () => {
    const repoRoot = await createTempRepo();
    const reportPath = await writeOfficialReportFixture(repoRoot);
    const manifestPath = path.join(repoRoot, "op", ".artifacts", "manifest.json");
    const uploadedKeys: string[] = [];

    await publishBenchmarkArtifacts({
      repoRoot,
      target,
      args: publishArgs(reportPath, manifestPath, "upload"),
      now: new Date("2026-06-24T12:00:00.000Z"),
      uploadArtifact: async (_target, upload) => {
        uploadedKeys.push(upload.artifact.objectKey);
      },
    });

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(uploadedKeys).toHaveLength(2);
    expect(manifest.artifacts.map((artifact: { objectKey: string }) => artifact.objectKey)).toEqual(
      uploadedKeys,
    );
  });
});
