import { bench, describe } from "vitest";
import {
  BASELINE_IMPLEMENTATION_ID,
  asComparisonOp,
  asComparisonPolicy,
  createComparisonScenarios,
  runOverheadRatioBench,
} from "./comparison-matrix.ts";
import { asBenchOp } from "./harness.ts";
import { Op } from "@prodkit/op";
import { Policy } from "@prodkit/op/policy";
import { runOpFlatLoop, runOpSequentialRuns } from "./scenarios.ts";

const op = asBenchOp(Op);
const comparisonScenarios = createComparisonScenarios({
  Op: asComparisonOp(Op),
  Policy: asComparisonPolicy(Policy),
});

for (const scenario of comparisonScenarios) {
  describe(scenario.group, () => {
    const opCell = scenario.implementations.op;
    bench(opCell.benchName, opCell.run);
  });
}

describe("overhead", () => {
  for (const scenario of comparisonScenarios) {
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
