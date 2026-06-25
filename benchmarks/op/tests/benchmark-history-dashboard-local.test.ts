import { describe, expect, it } from "vitest";
import { handleBenchmarkHistoryRequest } from "../history/benchmark-history-api.ts";
import {
  createMockBenchmarkHistoryEnv,
  startBenchmarkHistoryDashboardMockServer,
} from "../history/benchmark-history-dashboard-local.ts";

const quietLogger = {
  error() {},
  info() {},
};

describe("benchmark history dashboard local mock", () => {
  it("seeds latest run, comparison, and scenario history data", async () => {
    const env = await createMockBenchmarkHistoryEnv();
    const latest = await handleBenchmarkHistoryRequest(
      new Request("https://benchmarks.example.com/api/benchmarks/latest?kind=comparison"),
      env,
    );
    const comparisons = await handleBenchmarkHistoryRequest(
      new Request("https://benchmarks.example.com/api/benchmarks/comparisons"),
      env,
    );
    const history = await handleBenchmarkHistoryRequest(
      new Request(
        "https://benchmarks.example.com/api/benchmarks/scenarios/compose.opYieldChain/history?implementation=op",
      ),
      env,
    );

    await expect(latest.json()).resolves.toMatchObject({
      id: "comparison-bbbbbbbbbbbb-20260623130000",
      scenarioCount: 3,
      artifactCount: 4,
    });
    await expect(comparisons.json()).resolves.toMatchObject({
      comparisons: [
        {
          summary: {
            improvement: 1,
            regression: 1,
            inconclusive: 1,
          },
        },
      ],
    });
    await expect(history.json()).resolves.toMatchObject({
      history: [
        {
          runId: "comparison-bbbbbbbbbbbb-20260623130000",
        },
        {
          runId: "comparison-aaaaaaaaaaaa-20260623120000",
        },
      ],
    });
  });

  it("serves the dashboard and API through the local mock server", async () => {
    const mock = await startBenchmarkHistoryDashboardMockServer({
      port: 0,
      logger: quietLogger,
    });
    try {
      const dashboard = await fetch(`${mock.url}/runs/comparison-bbbbbbbbbbbb-20260623130000`);
      const latest = await fetch(`${mock.url}/api/benchmarks/latest?kind=comparison`);

      expect(dashboard.status).toBe(200);
      await expect(dashboard.text()).resolves.toContain("prodkit benchmark history");
      await expect(latest.json()).resolves.toMatchObject({
        id: "comparison-bbbbbbbbbbbb-20260623130000",
      });
    } finally {
      await mock.close();
    }
  });
});
