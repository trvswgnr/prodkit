import { describe, expect, test } from "vitest";
import { Settlement } from "../../../src/execution/settlement.js";
import {
  AbortSettlement,
  isAbortDrainedWork,
  settlementForSuspendedWork,
} from "../../../src/execution/abort-settlement.js";
import { SuspendInstruction } from "../../../src/execution/instructions.js";
import { createRunContext } from "../../../src/execution/runtime.js";
import { genPlan } from "../../../src/plan/model.js";
import { Result } from "../../../src/result.js";
import { UnhandledException } from "../../../src/errors.js";

describe("Settlement", () => {
  test("interruptingAndDraining suspend marks observed work for drain upgrade", () => {
    const controller = new AbortController();
    const instruction = Settlement.interruptingAndDraining.suspend(() => Promise.resolve(1));
    const work = instruction.suspend(createRunContext(controller.signal));

    expect(isAbortDrainedWork(work)).toBe(true);
    expect(
      settlementForSuspendedWork(
        AbortSettlement.interruptOnAbort(() => "abort"),
        work,
      ).settlement.kind,
    ).toBe("interruptAndDrainOnAbort");
  });

  test("rejecting awaitWork rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("cancelled");

    await expect(
      Settlement.rejecting.awaitWork(Promise.resolve(1), controller.signal),
    ).rejects.toBe("cancelled");
  });

  test("interruptingAndDraining suspendPlan marks nested plan work for drain", () => {
    const controller = new AbortController();
    const instruction = Settlement.interruptingAndDraining.suspendPlan(
      genPlan(function* () {
        return 1;
      }),
    );
    const work = instruction.suspend(createRunContext(controller.signal));

    expect(instruction).toBeInstanceOf(SuspendInstruction);
    expect(isAbortDrainedWork(work)).toBe(true);
  });

  test("cooperative runPlan uses pass-through launch settlement", async () => {
    const controller = new AbortController();
    const plan = genPlan(function* () {
      return 7;
    });

    const result = await Settlement.cooperative.runPlan(plan, createRunContext(controller.signal));

    expect(result).toEqual(Result.ok(7));
  });

  test("cooperative suspendPlan creates unbranded nested plan work", async () => {
    const controller = new AbortController();
    const instruction = Settlement.cooperative.suspendPlan(
      genPlan(function* () {
        return 7;
      }),
    );
    const work = instruction.suspend(createRunContext(controller.signal));

    expect(instruction).toBeInstanceOf(SuspendInstruction);
    expect(isAbortDrainedWork(work)).toBe(false);
    await expect(work).resolves.toEqual(Result.ok(7));
  });

  test("interrupting runPlan unwinds suspended work after abort", async () => {
    const controller = new AbortController();
    const abortCause = new Error("cancelled");
    const plan = genPlan(function* () {
      yield* new SuspendInstruction(() => new Promise(() => {}));
      return 7;
    });

    const resultPromise = Settlement.interrupting.runPlan(
      plan,
      createRunContext(controller.signal),
    );
    controller.abort(abortCause);
    const result = await resultPromise;

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(UnhandledException);
      if (result.error instanceof UnhandledException) {
        expect(result.error.cause).toBe(abortCause);
      }
    }
  });
});
