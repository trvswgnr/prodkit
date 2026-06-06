import { describe, test, expect } from "vitest";
import { Settlement, SettlementPresets } from "../../src/core/settlement-scope.js";
import {
  isAbortDrainedWork,
  settlementForSuspendedWork,
  AbortSettlement,
} from "../../src/core/settlement.js";
import { genPlan } from "../../src/core/plan/base.js";
import { SuspendInstruction } from "../../src/core/instructions.js";
import { createRunContext } from "../../src/core/runtime.js";
import { Result } from "../../src/result.js";

describe("Settlement presets", () => {
  test("interruptingAndDraining marks observed suspend work for drain upgrade", () => {
    const controller = new AbortController();
    const scope = Settlement.interruptingAndDraining(controller.signal);
    const work = scope.observeWork(Promise.resolve(1));

    expect(isAbortDrainedWork(work)).toBe(true);
    expect(
      settlementForSuspendedWork(
        AbortSettlement.interruptOnAbort(() => "abort"),
        work,
      ).settlement.kind,
    ).toBe("interruptAndDrainOnAbort");
  });

  test("interrupting does not brand suspend work for drain", () => {
    const controller = new AbortController();
    const scope = Settlement.interrupting(controller.signal);
    const work = scope.observeWork(Promise.resolve(1));

    expect(isAbortDrainedWork(work)).toBe(false);
  });

  test("rejecting awaitWork rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("cancelled");

    await expect(
      Settlement.rejecting(controller.signal).awaitWork(Promise.resolve(1)),
    ).rejects.toBe("cancelled");
  });

  test("suspendPlan uses interrupt launch and drain observation for provision preset", () => {
    const instruction = Settlement.suspendPlan(
      SettlementPresets.interruptingAndDraining,
      genPlan(function* () {
        return 1;
      }),
    );

    expect(instruction).toBeInstanceOf(SuspendInstruction);
    expect(SettlementPresets.interruptingAndDraining.launch).toBe("interrupt");
    expect(SettlementPresets.interruptingAndDraining.completion).toBe("drain");
  });

  test("cooperative runPlan uses passThrough launch settlement", async () => {
    const controller = new AbortController();
    const plan = genPlan(function* () {
      return 7;
    });

    const result = await Settlement.cooperative(controller.signal).runPlan(
      plan,
      createRunContext(controller.signal),
    );

    expect(result).toEqual(Result.ok(7));
  });
});
