import { describe, expect, it, beforeAll } from "vitest";
import {
  asBenchOp,
  getRepoRoot,
  importOpModule,
  resolveOpPackageDir,
  type BenchOp,
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
import {
  runEffectAll,
  runEffectFirstSuccess,
  runEffectRaceFirst,
  runEffectRetry,
  runEffectSingleValue,
  runEffectTimeout,
  runEffectYieldChain,
} from "../effect-scenarios.ts";

describe("profile scenarios", () => {
  const steps = 3;
  const expected = steps + 1;
  let Op: BenchOp;

  beforeAll(async () => {
    const packageDir = resolveOpPackageDir(getRepoRoot());
    const module = await importOpModule(packageDir);
    Op = asBenchOp(module.Op);
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

  it("Effect-backed scenarios complete without error", async () => {
    await expect(runEffectSingleValue()).resolves.toBeUndefined();
    await expect(runEffectAll()).resolves.toBeUndefined();
    await expect(runEffectFirstSuccess()).resolves.toBeUndefined();
    await expect(runEffectRaceFirst()).resolves.toBeUndefined();
    await expect(runEffectRetry()).resolves.toBeUndefined();
    await expect(runEffectTimeout()).resolves.toBeUndefined();
    await expect(runEffectYieldChain(steps)).resolves.toBe(expected);
  });

  it("default compose steps remain stable", () => {
    expect(COMPOSE_STEPS).toBe(6);
  });
});
