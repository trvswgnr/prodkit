import { describe, expect, it, beforeAll } from "vitest";
import {
  asComparisonOp,
  asComparisonPolicy,
  createComparisonScenarios,
  type ComparisonRuntime,
} from "../runtime/comparison-matrix.ts";
import {
  asBenchOp,
  getRepoRoot,
  importOpModule,
  resolveOpPackageDir,
  type BenchOp,
} from "../runtime/harness.ts";
import { createProfileScenarios } from "../cli/profile.ts";
import {
  COMPOSE_STEPS,
  runAsyncChain,
  runAsyncFnChain,
  runOpFlatLoop,
  runOpSequentialRuns,
  runOpYieldChain,
  runRawSyncYieldStarChain,
  runSingleOpRun,
} from "../runtime/scenarios.ts";
import {
  runEffectAll,
  runEffectFirstSuccess,
  runEffectRaceFirst,
  runEffectRetry,
  runEffectSingleValue,
  runEffectTimeout,
  runEffectYieldChain,
} from "../runtime/effect-scenarios.ts";
import { Op as WorkspaceOp } from "@prodkit/op";
import { Policy as WorkspacePolicy } from "@prodkit/op/policy";

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

  it("profile scenarios include CodSpeed bench names", () => {
    const runtime: ComparisonRuntime = {
      Op: asComparisonOp(WorkspaceOp),
      Policy: asComparisonPolicy(WorkspacePolicy),
    };
    const profileScenarios = createProfileScenarios(asBenchOp(WorkspaceOp), runtime);
    const profileNames = new Set<string>();
    const primaryNames = profileScenarios.map((scenario) => scenario.name);
    expect(new Set(primaryNames).size).toBe(primaryNames.length);
    for (const scenario of profileScenarios) {
      profileNames.add(scenario.name);
      for (const alias of scenario.aliases ?? []) {
        profileNames.add(alias);
      }
    }

    for (const scenario of createComparisonScenarios(runtime)) {
      expect(profileNames.has(scenario.implementations.op.benchName)).toBe(true);
      expect(profileNames.has(scenario.overheadBench)).toBe(true);
    }
    expect(profileNames.has("compose.opFlatLoop")).toBe(true);
    expect(profileNames.has("compose.opSequentialRuns")).toBe(true);
    expect(profileNames.has("compose.rawSyncYieldStar")).toBe(true);
    expect(profileNames.has("generator.rawYieldStarSync")).toBe(true);
  });
});
