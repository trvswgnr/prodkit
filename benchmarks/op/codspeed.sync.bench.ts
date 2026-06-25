import { bench, describe } from "vitest";
import { runRawSyncYieldStarChain } from "./runtime/scenarios.ts";

describe("compose", () => {
  bench("compose.rawSyncYieldStar", () => {
    runRawSyncYieldStarChain();
  });
});
