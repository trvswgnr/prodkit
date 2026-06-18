import { afterAll, bench, describe } from "vitest";
import { createOpLintBenchmarkSuite } from "./scenarios.ts";

const suite = createOpLintBenchmarkSuite();

afterAll(() => {
  suite.cleanup();
});

describe("@prodkit/op-lint require-yield-star", () => {
  for (const scenario of suite.scenarios) {
    bench(scenario.name, () => {
      scenario.run();
    });
  }
});
