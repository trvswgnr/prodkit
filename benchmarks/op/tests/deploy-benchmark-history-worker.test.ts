import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BENCHMARK_HISTORY_COMPATIBILITY_DATE,
  DEFAULT_BENCHMARK_HISTORY_WORKER_NAME,
  createBenchmarkHistoryWorkerWranglerConfig,
  deployBenchmarkHistoryWorker,
  parseBenchmarkHistoryWorkerDeployArgs,
} from "../deploy-benchmark-history-worker.ts";

describe("deploy benchmark history Worker", () => {
  it("builds a Wrangler config for the public dashboard Worker", () => {
    expect(
      createBenchmarkHistoryWorkerWranglerConfig({
        name: "prodkit-benchmarks",
        main: "../benchmark-history-api.ts",
        compatibilityDate: "2026-06-25",
        kvNamespaceId: "kv-namespace-id",
        artifactBaseUrl: "https://benchmarks.example.com/artifacts",
      }),
    ).toMatchObject({
      name: "prodkit-benchmarks",
      main: "../benchmark-history-api.ts",
      compatibility_date: "2026-06-25",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: true,
      kv_namespaces: [
        {
          binding: "PRODKIT_BENCHMARK_HISTORY",
          id: "kv-namespace-id",
        },
      ],
      vars: {
        PRODKIT_BENCHMARK_ARTIFACT_BASE_URL: "https://benchmarks.example.com/artifacts",
      },
    });
  });

  it("parses environment fallbacks and defaults", () => {
    expect(
      parseBenchmarkHistoryWorkerDeployArgs(["--dry-run"], {
        PRODKIT_BENCHMARK_HISTORY_KV_NAMESPACE_ID: "kv-namespace-id",
      }),
    ).toMatchObject({
      name: DEFAULT_BENCHMARK_HISTORY_WORKER_NAME,
      compatibilityDate: DEFAULT_BENCHMARK_HISTORY_COMPATIBILITY_DATE,
      kvNamespaceId: "kv-namespace-id",
      dryRun: true,
    });
  });

  it("writes config during dry run without invoking Wrangler", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "prodkit-benchmark-worker-"));
    const configPath = path.join(dir, "wrangler.json");
    try {
      const status = await deployBenchmarkHistoryWorker(
        ["--dry-run", `--config=${configPath}`, "--kv-namespace-id=kv-namespace-id"],
        {
          runWrangler() {
            throw new Error("wrangler should not run during dry run");
          },
        },
      );

      await expect(readFile(configPath, "utf8").then(JSON.parse)).resolves.toMatchObject({
        main: "../benchmark-history-api.ts",
        kv_namespaces: [
          {
            id: "kv-namespace-id",
          },
        ],
      });
      expect(status).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
