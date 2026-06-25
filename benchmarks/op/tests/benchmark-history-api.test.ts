import { describe, expect, it } from "vitest";
import {
  BENCHMARK_HISTORY_API_VERSION,
  handleBenchmarkHistoryRequest,
  KvBenchmarkHistoryIndex,
  type BenchmarkHistoryApiEnv,
  type BenchmarkHistoryKvNamespace,
} from "../history/benchmark-history-api.ts";
import {
  OFFICIAL_BENCHMARK_REPORT_VERSION,
  type BenchmarkDiff,
  type OfficialBenchmarkReport,
} from "../reports/official-report.ts";
import {
  BENCHMARK_PUBLISH_MANIFEST_VERSION,
  type BenchmarkPublishManifest,
} from "../cli/publish-artifacts.ts";
import { TRUSTED_REF_COMPARISON_REPORT_VERSION } from "../reports/trusted-ref-comparison-report.ts";

const scenarioKey = "compose.opYieldChain";

const benchOptions = {
  time: 300,
  warmupTime: 150,
  warmupIterations: 5,
  repeats: 1,
};

class MemoryKv implements BenchmarkHistoryKvNamespace {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

function env(kv = new MemoryKv()): BenchmarkHistoryApiEnv {
  return {
    PRODKIT_BENCHMARK_HISTORY: kv,
    PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN: "trusted-token",
  };
}

function officialReport(
  input: {
    runId?: string;
    generatedAt?: string;
    headSha?: string;
    hz?: number;
  } = {},
): OfficialBenchmarkReport {
  return {
    schemaVersion: OFFICIAL_BENCHMARK_REPORT_VERSION,
    run: {
      id: input.runId ?? "comparison-aaaaaaaaaaaa-20260623120000",
      kind: "comparison",
      generatedAt: input.generatedAt ?? "2026-06-23T12:00:00.000Z",
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
      headSha: input.headSha ?? "a".repeat(40),
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
        key: scenarioKey,
        label: scenarioKey,
        group: "comparison",
        implementationId: "op",
        implementationLabel: "op",
        benchName: scenarioKey,
        description: "op yield chain",
        stats: {
          hz: input.hz ?? 100,
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
            scenarioKey,
            implementationId: "op",
          },
        ],
      },
    ],
  };
}

function officialManifest(report: OfficialBenchmarkReport): BenchmarkPublishManifest {
  return {
    schemaVersion: BENCHMARK_PUBLISH_MANIFEST_VERSION,
    generatedAt: "2026-06-23T12:01:00.000Z",
    mode: "upload",
    provider: "cloudflare-r2",
    bucket: "prodkit-benchmarks",
    endpoint: "https://example-account.r2.cloudflarestorage.com",
    source: {
      reportPath: "op/.artifacts/comparison-report.json",
      reportSchemaVersion: OFFICIAL_BENCHMARK_REPORT_VERSION,
      runIds: [report.run.id],
    },
    artifacts: [
      {
        kind: "report",
        path: "op/.artifacts/comparison-report.json",
        contentType: "application/json",
        objectKey: `official/comparison/${report.run.id}/run/report/comparison-report.json`,
        sizeBytes: 1000,
        sha256: "c".repeat(64),
      },
      {
        kind: "cpu-profile",
        path: ".profiles/op/CPU.test.cpuprofile",
        contentType: "application/json",
        scenarioKey,
        implementationId: "op",
        objectKey: `official/comparison/${report.run.id}/scenario/${scenarioKey}/op/cpu-profile/CPU.test.cpuprofile`,
        sizeBytes: 500,
        sha256: "d".repeat(64),
      },
    ],
  };
}

function targetFingerprint(digest: string) {
  return {
    algorithm: "sha256",
    digest,
    sources: ["dist/index.mjs"],
  };
}

function trustedComparisonReport(
  base: OfficialBenchmarkReport,
  candidate: OfficialBenchmarkReport,
) {
  const diff: BenchmarkDiff = {
    kind: "comparison",
    implementationId: "op",
    baseRun: base.run,
    candidateRun: candidate.run,
    summary: {
      improvement: 1,
      regression: 0,
      inconclusive: 0,
    },
    scenarios: [
      {
        key: scenarioKey,
        label: scenarioKey,
        implementationId: "op",
        baseHz: 100,
        candidateHz: 125,
        deltaRatio: 0.25,
        combinedNoiseRatio: 0.01,
        noiseThresholdRatio: 0.02,
        verdict: "improvement",
      },
    ],
  };
  return {
    schemaVersion: TRUSTED_REF_COMPARISON_REPORT_VERSION,
    generatedAt: "2026-06-23T12:02:00.000Z",
    implementationId: "op",
    benchOptions,
    scenarioOrder: [{ scenarioKey, first: "base" }],
    base: {
      ref: "main",
      sha: base.commit.headSha,
      packageVersion: "0.2.2",
      targetFingerprint: targetFingerprint("1".repeat(64)),
      report: base,
    },
    candidate: {
      ref: "feature/perf",
      sha: candidate.commit.headSha,
      packageVersion: "0.2.2",
      targetFingerprint: targetFingerprint("2".repeat(64)),
      report: candidate,
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

function trustedManifest(
  base: OfficialBenchmarkReport,
  candidate: OfficialBenchmarkReport,
): BenchmarkPublishManifest {
  return {
    schemaVersion: BENCHMARK_PUBLISH_MANIFEST_VERSION,
    generatedAt: "2026-06-23T12:03:00.000Z",
    mode: "upload",
    provider: "cloudflare-r2",
    bucket: "prodkit-benchmarks",
    endpoint: "https://example-account.r2.cloudflarestorage.com",
    source: {
      reportPath: "op/.artifacts/trusted-ref-comparison-report.json",
      reportSchemaVersion: TRUSTED_REF_COMPARISON_REPORT_VERSION,
      runIds: [base.run.id, candidate.run.id],
    },
    artifacts: [
      {
        kind: "report",
        path: "op/.artifacts/trusted-ref-comparison-report.json",
        contentType: "application/json",
        objectKey: `official/trusted-ref-comparison/${base.run.id}__${candidate.run.id}/run/report/trusted-ref-comparison-report.json`,
        sizeBytes: 1500,
        sha256: "e".repeat(64),
      },
    ],
  };
}

async function postIndex(
  apiEnv: BenchmarkHistoryApiEnv,
  body: unknown,
  token = "trusted-token",
): Promise<Response> {
  return handleBenchmarkHistoryRequest(
    new Request("https://benchmarks.example.com/api/benchmarks/index", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    apiEnv,
  );
}

async function getJson(apiEnv: BenchmarkHistoryApiEnv, path: string): Promise<unknown> {
  const response = await handleBenchmarkHistoryRequest(
    new Request(`https://benchmarks.example.com${path}`),
    apiEnv,
  );
  expect(response.ok).toBe(true);
  return response.json();
}

describe("benchmark history API", () => {
  it("indexes a published official run and serves latest, detail, and scenario history", async () => {
    const apiEnv = env();
    const report = officialReport();
    const response = await postIndex(apiEnv, {
      manifest: officialManifest(report),
      report,
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: BENCHMARK_HISTORY_API_VERSION,
      indexedRunIds: [report.run.id],
      indexedComparisonIds: [],
    });

    await expect(getJson(apiEnv, "/api/benchmarks/latest")).resolves.toMatchObject({
      id: report.run.id,
      scenarioCount: 1,
      artifactCount: 2,
    });
    await expect(getJson(apiEnv, `/api/benchmarks/runs/${report.run.id}`)).resolves.toMatchObject({
      id: report.run.id,
      artifacts: [
        {
          objectKey: `official/comparison/${report.run.id}/run/report/comparison-report.json`,
          sha256: "c".repeat(64),
        },
        {
          objectKey: `official/comparison/${report.run.id}/scenario/${scenarioKey}/op/cpu-profile/CPU.test.cpuprofile`,
          scenarioKey,
        },
      ],
    });
    await expect(
      getJson(apiEnv, `/api/benchmarks/scenarios/${scenarioKey}/history?implementation=op`),
    ).resolves.toMatchObject({
      scenarioKey,
      implementationId: "op",
      history: [
        {
          runId: report.run.id,
          stats: {
            hz: 100,
          },
        },
      ],
    });
  });

  it("rejects unauthorized index writes", async () => {
    const apiEnv = env();
    const report = officialReport();
    const response = await postIndex(
      apiEnv,
      {
        manifest: officialManifest(report),
        report,
      },
      "wrong-token",
    );

    expect(response.status).toBe(401);
    const index = new KvBenchmarkHistoryIndex(apiEnv.PRODKIT_BENCHMARK_HISTORY);
    await expect(index.latestRun()).resolves.toBeUndefined();
  });

  it("keeps repeated writes for the same official run idempotent", async () => {
    const apiEnv = env();
    const report = officialReport();
    const body = {
      manifest: officialManifest(report),
      report,
    };

    expect((await postIndex(apiEnv, body)).status).toBe(201);
    expect((await postIndex(apiEnv, body)).status).toBe(201);

    await expect(
      getJson(apiEnv, `/api/benchmarks/scenarios/${scenarioKey}/history?implementation=op`),
    ).resolves.toMatchObject({
      history: [
        {
          runId: report.run.id,
        },
      ],
    });
  });

  it("indexes trusted comparison reports and serves comparison summaries", async () => {
    const apiEnv = env();
    const base = officialReport({
      runId: "comparison-aaaaaaaaaaaa-20260623120000",
      headSha: "a".repeat(40),
      hz: 100,
    });
    const candidate = officialReport({
      runId: "comparison-bbbbbbbbbbbb-20260623130000",
      generatedAt: "2026-06-23T13:00:00.000Z",
      headSha: "b".repeat(40),
      hz: 125,
    });
    const response = await postIndex(apiEnv, {
      manifest: trustedManifest(base, candidate),
      report: trustedComparisonReport(base, candidate),
    });

    expect(response.status).toBe(201);
    await expect(getJson(apiEnv, "/api/benchmarks/comparisons")).resolves.toMatchObject({
      comparisons: [
        {
          id: `${base.run.id}__${candidate.run.id}`,
          summary: {
            improvement: 1,
          },
          targetFingerprintChanged: true,
          scenarios: [
            {
              deltaRatio: 0.25,
              verdict: "improvement",
            },
          ],
          artifacts: [
            {
              objectKey: `official/trusted-ref-comparison/${base.run.id}__${candidate.run.id}/run/report/trusted-ref-comparison-report.json`,
            },
          ],
        },
      ],
    });
  });

  it("serves the dashboard shell from the history Worker", async () => {
    const response = await handleBenchmarkHistoryRequest(
      new Request("https://benchmarks.example.com/"),
      env(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(response.text()).resolves.toContain("prodkit benchmark history");
  });

  it("rejects dry-run manifests because no artifacts were published", async () => {
    const apiEnv = env();
    const report = officialReport();
    const manifest = {
      ...officialManifest(report),
      mode: "dry-run",
    };

    const response = await postIndex(apiEnv, {
      manifest,
      report,
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Error: manifest.mode: expected upload manifest from a completed publish",
    });
  });
});
