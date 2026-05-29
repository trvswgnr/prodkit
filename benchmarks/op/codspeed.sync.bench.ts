import { bench, describe } from "vitest";
import { runRawSyncYieldStarChain } from "./scenarios.ts";

describe("compose", () => {
  bench("compose.rawSyncYieldStar", () => {
    runRawSyncYieldStarChain();
  });
});
