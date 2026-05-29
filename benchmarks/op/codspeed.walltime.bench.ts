import { bench, describe } from "vitest";
import {
  BASELINE_IMPLEMENTATION_ID,
  COMPARISON_SCENARIOS,
  runOverheadRatioBench,
} from "./comparison-matrix.ts";
import { assertProfileOpFactory } from "./harness.ts";
import { Op } from "@prodkit/op";
import { runOpFlatLoop, runOpSequentialRuns } from "./scenarios.ts";

const op = assertProfileOpFactory(Op);

for (const scenario of COMPARISON_SCENARIOS) {
  describe(scenario.group, () => {
    const opCell = scenario.implementations.op;
    bench(opCell.benchName, opCell.run);
  });
}

describe("overhead", () => {
  for (const scenario of COMPARISON_SCENARIOS) {
    bench(scenario.overheadBench, async () => {
      await runOverheadRatioBench(
        scenario.implementations[BASELINE_IMPLEMENTATION_ID].run,
        scenario.implementations.op.run,
      );
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
