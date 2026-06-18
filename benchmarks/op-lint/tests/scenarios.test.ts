import { describe, expect, it } from "vitest";
import { createOpLintBenchmarkSuite } from "../scenarios.ts";

describe("op-lint benchmark scenarios", () => {
  it("report require-yield-star diagnostics", () => {
    const suite = createOpLintBenchmarkSuite({
      coldFileCount: 4,
      coldPrograms: 1,
      directPrograms: 1,
      includeCli: false,
      warmPrograms: 1,
    });

    try {
      for (const scenario of suite.scenarios) {
        expect(scenario.run(), scenario.name).toBeGreaterThan(0);
      }
    } finally {
      suite.cleanup();
    }
  });
});
