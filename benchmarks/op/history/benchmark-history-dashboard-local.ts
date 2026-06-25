import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import {
  handleBenchmarkHistoryRequest,
  KvBenchmarkHistoryIndex,
  type BenchmarkHistoryApiEnv,
  type BenchmarkHistoryComparisonSummary,
  type BenchmarkHistoryKvNamespace,
  type BenchmarkHistoryRunDetail,
  type BenchmarkHistoryScenarioSample,
} from "./benchmark-history-api.ts";
import {
  BENCHMARK_CALIBRATION_REPORT_VERSION,
  OFFICIAL_BENCHMARK_REPORT_VERSION,
  type BenchmarkRunnerIdentity,
} from "../reports/official-report.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4175;
const MOCK_ARTIFACT_BASE_URL = "https://benchmarks.example.com/artifacts";
const defaultLogger = console;

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

function mockRunner(): BenchmarkRunnerIdentity {
  return {
    id: "local-mock-runner",
    node: "v24.14.0",
    platform: "darwin",
    arch: "arm64",
    cpu: {
      model: "local mock cpu",
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

function stats(hz: number, rme: number): BenchmarkHistoryScenarioSample["stats"] {
  return {
    hz,
    latencyMs: 1_000 / hz,
    latencyMinMs: (1_000 / hz) * 0.92,
    latencyMaxMs: (1_000 / hz) * 1.08,
    semMs: 0.01,
    rme,
    sampleCount: 120,
  };
}

function scenario(input: {
  runId: string;
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
  hz: number;
  rme: number;
}): BenchmarkHistoryScenarioSample {
  const objectKey = `official/comparison/${input.runId}/scenario/${input.key}/${input.implementationId}/cpu-profile/profile.cpuprofile`;
  return {
    runId: input.runId,
    runKind: "comparison",
    generatedAt: input.generatedAt,
    commitHeadSha: input.commitHeadSha,
    runnerId: input.runnerId,
    key: input.key,
    label: input.label,
    group: input.group,
    implementationId: input.implementationId,
    implementationLabel: input.implementationLabel,
    benchName: input.benchName,
    description: input.description,
    stats: stats(input.hz, input.rme),
    artifacts: [
      {
        kind: "cpu-profile",
        path: ".profiles/op/profile.cpuprofile",
        contentType: "application/json",
        objectKey,
        scenarioKey: input.key,
        implementationId: input.implementationId,
        sizeBytes: 485_310,
        sha256: "d".repeat(64),
      },
    ],
  };
}

function runDetail(input: {
  id: string;
  generatedAt: string;
  commitHeadSha: string;
  scenarios: BenchmarkHistoryScenarioSample[];
}): BenchmarkHistoryRunDetail {
  const runArtifact = {
    kind: "report",
    path: "op/.artifacts/comparison-report.json",
    contentType: "application/json",
    objectKey: `official/comparison/${input.id}/run/report/comparison-report.json`,
    sizeBytes: 12_840,
    sha256: "c".repeat(64),
  };
  const artifacts = [runArtifact, ...input.scenarios.flatMap((item) => item.artifacts)];
  return {
    id: input.id,
    kind: "comparison",
    generatedAt: input.generatedAt,
    commit: {
      headSha: input.commitHeadSha,
      dirty: false,
    },
    runner: mockRunner(),
    packages: [
      {
        name: "@prodkit/op",
        version: "0.2.2",
        packageDir: "packages/op",
      },
    ],
    scenarioCount: input.scenarios.length,
    artifactCount: artifacts.length,
    schemaVersion: OFFICIAL_BENCHMARK_REPORT_VERSION,
    run: {
      id: input.id,
      kind: "comparison",
      generatedAt: input.generatedAt,
      artifacts: [runArtifact],
    },
    benchOptions: {
      time: 300,
      warmupTime: 150,
      warmupIterations: 5,
      repeats: 3,
    },
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
    artifacts,
    scenarios: input.scenarios,
    calibration: {
      schemaVersion: BENCHMARK_CALIBRATION_REPORT_VERSION,
      generatedAt: input.generatedAt,
      runnerId: "local-mock-runner",
      sampleCount: 5,
      thresholds: {
        microbenchmarkNoiseRatio: 0.02,
        workflowNoiseRatio: 0.05,
      },
      recommendations: {
        microbenchmark: {
          decision: "acceptable",
          thresholdRatio: 0.02,
          worstNoiseBandRatio: 0.014,
          worstScenarioKey: "policy.retry",
          reason: "Mock runner noise is within the configured microbenchmark threshold.",
        },
        workflow: {
          decision: "acceptable",
          thresholdRatio: 0.05,
          worstNoiseBandRatio: 0.024,
          worstScenarioKey: "all.opAll",
          reason: "Mock runner workflow noise is within the configured threshold.",
        },
      },
      scenarioSummaries: input.scenarios.map((item) => ({
        key: item.key,
        label: item.label,
        benchName: item.benchName,
        sampleCount: 5,
        medianAbsoluteDeltaRatio: 0.006,
        p95AbsoluteDeltaRatio: 0.012,
        maxAbsoluteDeltaRatio: 0.014,
        averageCombinedNoiseRatio: 0.01,
        noiseBandRatio: 0.014,
        samples: [
          {
            sampleIndex: 0,
            first: "left",
            leftHz: item.stats.hz,
            rightHz: item.stats.hz * 1.004,
            deltaRatio: 0.004,
            absoluteDeltaRatio: 0.004,
            combinedNoiseRatio: 0.01,
          },
        ],
      })),
      artifact: {
        kind: "calibration-report",
        path: "op/.artifacts/benchmark-calibration-report.json",
        contentType: "application/json",
        objectKey: `official/comparison/${input.id}/run/report/benchmark-calibration-report.json`,
      },
    },
  };
}

function mockScenarios(input: {
  runId: string;
  generatedAt: string;
  commitHeadSha: string;
  composeHz: number;
  composeRme: number;
  allHz: number;
  allRme: number;
  retryHz: number;
  retryRme: number;
}): BenchmarkHistoryScenarioSample[] {
  const runnerId = "local-mock-runner";
  return [
    scenario({
      runId: input.runId,
      generatedAt: input.generatedAt,
      commitHeadSha: input.commitHeadSha,
      runnerId,
      key: "compose.opYieldChain",
      label: "Op yield chain",
      group: "comparison",
      implementationId: "op",
      implementationLabel: "Op",
      benchName: "compose.opYieldChain",
      description: "Sequential Op composition.",
      hz: input.composeHz,
      rme: input.composeRme,
    }),
    scenario({
      runId: input.runId,
      generatedAt: input.generatedAt,
      commitHeadSha: input.commitHeadSha,
      runnerId,
      key: "all.opAll",
      label: "Op.all",
      group: "comparison",
      implementationId: "op",
      implementationLabel: "Op",
      benchName: "all.opAll",
      description: "Parallel Op aggregation.",
      hz: input.allHz,
      rme: input.allRme,
    }),
    scenario({
      runId: input.runId,
      generatedAt: input.generatedAt,
      commitHeadSha: input.commitHeadSha,
      runnerId,
      key: "policy.retry",
      label: "Retry policy",
      group: "comparison",
      implementationId: "op",
      implementationLabel: "Op",
      benchName: "policy.retry",
      description: "Retry policy overhead.",
      hz: input.retryHz,
      rme: input.retryRme,
    }),
  ];
}

export async function createMockBenchmarkHistoryEnv(): Promise<BenchmarkHistoryApiEnv> {
  const kv = new MemoryKv();
  const index = new KvBenchmarkHistoryIndex(kv);
  const baseRunId = "comparison-aaaaaaaaaaaa-20260623120000";
  const candidateRunId = "comparison-bbbbbbbbbbbb-20260623130000";
  const baseScenarios = mockScenarios({
    runId: baseRunId,
    generatedAt: "2026-06-23T12:00:00.000Z",
    commitHeadSha: "a".repeat(40),
    composeHz: 92_000,
    composeRme: 1.1,
    allHz: 48_500,
    allRme: 1.4,
    retryHz: 23_000,
    retryRme: 1.6,
  });
  const candidateScenarios = mockScenarios({
    runId: candidateRunId,
    generatedAt: "2026-06-23T13:00:00.000Z",
    commitHeadSha: "b".repeat(40),
    composeHz: 108_500,
    composeRme: 1,
    allHz: 49_000,
    allRme: 1.3,
    retryHz: 21_900,
    retryRme: 1.8,
  });
  const base = runDetail({
    id: baseRunId,
    generatedAt: "2026-06-23T12:00:00.000Z",
    commitHeadSha: "a".repeat(40),
    scenarios: baseScenarios,
  });
  const candidate = runDetail({
    id: candidateRunId,
    generatedAt: "2026-06-23T13:00:00.000Z",
    commitHeadSha: "b".repeat(40),
    scenarios: candidateScenarios,
  });
  const comparison: BenchmarkHistoryComparisonSummary = {
    id: `${baseRunId}__${candidateRunId}`,
    generatedAt: "2026-06-23T13:03:00.000Z",
    implementationId: "op",
    base: {
      ref: "main",
      sha: "a".repeat(40),
      runId: baseRunId,
    },
    candidate: {
      ref: "feature/perf",
      sha: "b".repeat(40),
      runId: candidateRunId,
    },
    summary: {
      improvement: 1,
      regression: 1,
      inconclusive: 1,
    },
    scenarios: [
      {
        key: "compose.opYieldChain",
        label: "Op yield chain",
        implementationId: "op",
        baseHz: 92_000,
        candidateHz: 108_500,
        deltaRatio: 0.179,
        combinedNoiseRatio: 0.015,
        noiseThresholdRatio: 0.02,
        verdict: "improvement",
      },
      {
        key: "all.opAll",
        label: "Op.all",
        implementationId: "op",
        baseHz: 48_500,
        candidateHz: 49_000,
        deltaRatio: 0.01,
        combinedNoiseRatio: 0.022,
        noiseThresholdRatio: 0.02,
        verdict: "inconclusive",
      },
      {
        key: "policy.retry",
        label: "Retry policy",
        implementationId: "op",
        baseHz: 23_000,
        candidateHz: 21_900,
        deltaRatio: -0.048,
        combinedNoiseRatio: 0.018,
        noiseThresholdRatio: 0.02,
        verdict: "regression",
      },
    ],
    artifacts: [
      {
        kind: "report",
        path: "op/.artifacts/trusted-ref-comparison-report.json",
        contentType: "application/json",
        objectKey: `official/trusted-ref-comparison/${baseRunId}__${candidateRunId}/run/report/trusted-ref-comparison-report.json`,
        sizeBytes: 18_420,
        sha256: "e".repeat(64),
      },
    ],
  };

  await index.upsertRun(base);
  await index.upsertRun(candidate);
  await index.upsertComparison(comparison);

  return {
    PRODKIT_BENCHMARK_HISTORY: kv,
    PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN: "local-token",
    PRODKIT_BENCHMARK_ARTIFACT_BASE_URL: MOCK_ARTIFACT_BASE_URL,
  };
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(request: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const host = headers.get("host") ?? `${DEFAULT_HOST}:${DEFAULT_PORT}`;
  const url = new URL(request.url ?? "/", `http://${host}`);
  const body = await readRequestBody(request);
  return new Request(url, {
    method: request.method,
    headers,
    body,
  });
}

async function writeNodeResponse(nodeResponse: ServerResponse, response: Response): Promise<void> {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, key) => nodeResponse.setHeader(key, value));
  const body = Buffer.from(await response.arrayBuffer());
  nodeResponse.end(body);
}

export type BenchmarkHistoryDashboardMockServer = {
  env: BenchmarkHistoryApiEnv;
  server: Server;
  url: string;
  close: () => Promise<void>;
};

export type BenchmarkHistoryDashboardMockServerOptions = {
  host?: string;
  port?: number;
  env?: BenchmarkHistoryApiEnv;
  logger?: Pick<Console, "error" | "info">;
};

export async function startBenchmarkHistoryDashboardMockServer(
  options: BenchmarkHistoryDashboardMockServerOptions = {},
): Promise<BenchmarkHistoryDashboardMockServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const env = options.env ?? (await createMockBenchmarkHistoryEnv());
  const logger = options.logger ?? defaultLogger;
  const server = createServer((request, response) => {
    void (async () => {
      try {
        await writeNodeResponse(
          response,
          await handleBenchmarkHistoryRequest(await toWebRequest(request), env),
        );
      } catch (error) {
        logger.error(error);
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.end(String(error));
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const resolvedPort = typeof address === "object" && address !== null ? address.port : port;
  const url = `http://${host}:${resolvedPort}`;
  logger.info(`Benchmark history dashboard mock: ${url}`);
  return {
    env,
    server,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

function argValue(argv: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`;
  return argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Invalid --port value. Expected a TCP port.");
  }
  return port;
}

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  await startBenchmarkHistoryDashboardMockServer({
    host: argValue(argv, "--host") ?? DEFAULT_HOST,
    port: parsePort(argValue(argv, "--port")),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    defaultLogger.error(error);
    process.exitCode = 1;
  });
}
