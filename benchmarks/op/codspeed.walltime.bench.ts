import { bench, describe } from "vitest";
import { COMPARISON_SCENARIOS, runOverheadRatioBench } from "./comparison-matrix.ts";
import { assertProfileOpFactory } from "./harness.ts";
import { Op } from "@prodkit/op";
import { runOpFlatLoop, runOpSequentialRuns } from "./scenarios.ts";

const op = assertProfileOpFactory(Op);

for (const scenario of COMPARISON_SCENARIOS) {
  describe(scenario.group, () => {
    bench(scenario.opBench, scenario.op);
  });
}

describe("overhead", () => {
  for (const scenario of COMPARISON_SCENARIOS) {
    bench(scenario.overheadBench, async () => {
      await runOverheadRatioBench(scenario.native, scenario.op);
    });
  }
});

describe("compose", () => {
  bench("compose.opFlatLoop", async () => {
    await runOpFlatLoop(op);
  });

  bench("compose.opSequentialRuns", async () => {
    await runOpSequentialRuns(op);
  });
});
