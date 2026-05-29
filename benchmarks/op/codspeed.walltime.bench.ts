import { bench, describe } from "vitest";
import { Op } from "@prodkit/op";
import { COMPARISON_SCENARIOS, runOverheadRatioBench } from "./comparison-matrix.ts";
import { assertProfileOpFactory } from "./harness.ts";
import { runAsyncFnChain, runOpFlatLoop, runOpSequentialRuns } from "./scenarios.ts";

const op = assertProfileOpFactory(Op);

for (const scenario of COMPARISON_SCENARIOS) {
  describe(scenario.group, () => {
    bench(scenario.nativeBench, scenario.native);
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
  bench("compose.asyncFnChain", async () => {
    await runAsyncFnChain();
  });

  bench("compose.opFlatLoop", async () => {
    await runOpFlatLoop(op);
  });

  bench("compose.opSequentialRuns", async () => {
    await runOpSequentialRuns(op);
  });
});

describe("single-op-micro", () => {
  bench("single-op-micro.opRun", async () => {
    const result = await Op.of(69).run();
    if (!result.isOk()) throw new Error("single-op-micro.opRun failed unexpectedly.");
  });
});
