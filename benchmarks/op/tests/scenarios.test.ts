import { describe, expect, it, beforeAll } from "vitest";
import {
  assertProfileOpFactory,
  getRepoRoot,
  importOpModule,
  resolveOpPackageDir,
  type ProfileScenarioOpFactory,
} from "../harness.ts";
import {
  COMPOSE_STEPS,
  runAsyncChain,
  runAsyncFnChain,
  runOpFlatLoop,
  runOpSequentialRuns,
  runOpYieldChain,
  runRawSyncYieldStarChain,
  runSingleOpRun,
} from "../scenarios.ts";

describe("profile scenarios", () => {
  const steps = 3;
  const expected = steps + 1;
  let Op: ProfileScenarioOpFactory;

  beforeAll(async () => {
    const packageDir = resolveOpPackageDir(getRepoRoot());
    const module = await importOpModule(packageDir);
    Op = assertProfileOpFactory(module.Op);
  });

  it("runAsyncChain returns steps + 1", async () => {
    await expect(runAsyncChain(steps)).resolves.toBe(expected);
  });

  it("runAsyncFnChain returns steps + 1", async () => {
    await expect(runAsyncFnChain(steps)).resolves.toBe(expected);
  });

  it("runRawSyncYieldStarChain returns steps + 1", () => {
    expect(runRawSyncYieldStarChain(steps)).toBe(expected);
  });

  it("Op-backed scenarios return steps + 1", async () => {
    await expect(runOpYieldChain(Op, steps)).resolves.toBe(expected);
    await expect(runOpFlatLoop(Op, steps)).resolves.toBe(expected);
    await expect(runOpSequentialRuns(Op, steps)).resolves.toBe(expected);
    await expect(runSingleOpRun(Op)).resolves.toBeUndefined();
  });

  it("default compose steps remain stable", () => {
    expect(COMPOSE_STEPS).toBe(6);
  });
});
