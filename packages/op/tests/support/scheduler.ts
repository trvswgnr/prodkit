import type { Scheduler, SchedulerAct, SchedulerReportItem } from "fast-check";
import { vi } from "vitest";
import { Op } from "../../src/index.js";
import { Result } from "../../src/result.js";
import type { UnhandledException } from "../../src/errors.js";

export const FC_SCHEDULER_ASSERT_OPTIONS = { numRuns: 100 };

export type SchedulerRaceBranch = { kind: "ok"; value: number } | { kind: "err"; error: string };

export type SchedulerAnyBranch = { kind: "ok"; value: number } | { kind: "fail"; error: string };

export function buildWrapWithVitestTimersAct(s: Scheduler): SchedulerAct {
  let timersAlreadyScheduled = false;

  function scheduleTimersIfNeeded() {
    if (timersAlreadyScheduled || vi.getTimerCount() === 0) {
      return;
    }

    timersAlreadyScheduled = true;
    void s.schedule(Promise.resolve("advance timers")).then(() => {
      timersAlreadyScheduled = false;
      vi.advanceTimersToNextTimer();
      scheduleTimersIfNeeded();
    });
  }

  return async (f) => {
    try {
      await f();
    } finally {
      scheduleTimersIfNeeded();
    }
  };
}

function parseBranchIndex(label: string, prefix: string): number | undefined {
  if (!label.startsWith(prefix)) return undefined;
  const index = Number(label.slice(prefix.length));
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

export function branchAt<T>(branches: readonly T[], index: number): T {
  const branch = branches[index];
  if (branch === undefined) {
    throw new Error(`branch index ${index} is out of range (length ${branches.length})`);
  }
  return branch;
}

export function firstSettlerRaceBranchIndex(
  report: SchedulerReportItem[],
  prefix: string,
  branchCount: number,
): number {
  for (const item of report) {
    const index = parseBranchIndex(item.label, prefix);
    if (index === undefined || index >= branchCount) continue;
    if (item.status === "resolved" || item.status === "rejected") {
      return index;
    }
  }

  throw new Error(`scheduler report has no settled branch with prefix ${prefix}`);
}

export function raceResultFromBranch(
  branch: SchedulerRaceBranch,
): Result<number, string | UnhandledException> {
  if (branch.kind === "ok") {
    return Result.ok(branch.value);
  }

  return Result.err(branch.error);
}

export function raceOpFromScheduledBranch(
  s: Scheduler,
  branch: SchedulerRaceBranch,
  label: string,
): Op<number, string | UnhandledException, []> {
  if (branch.kind === "ok") {
    return Op.try(() => s.schedule(Promise.resolve(branch.value), label));
  }

  return Op.try(() => s.schedule(Promise.resolve(branch.error), label)).flatMap((error: string) =>
    Op.fail(error),
  );
}

export function assertRaceResultsEqual<T, E>(actual: Result<T, E>, expected: Result<T, E>): void {
  if (expected.isOk()) {
    if (!actual.isOk()) {
      throw new Error(`expected Ok(${String(expected.value)}), got ${String(actual)}`);
    }
    if (actual.value !== expected.value) {
      throw new Error(`expected Ok(${String(expected.value)}), got Ok(${String(actual.value)})`);
    }
    return;
  }

  if (!actual.isErr()) {
    throw new Error(`expected Err(${String(expected.error)}), got ${String(actual)}`);
  }
  if (actual.error !== expected.error) {
    throw new Error(`expected Err(${String(expected.error)}), got Err(${String(actual.error)})`);
  }
}

export function anyFailOpFromScheduledBranch(
  s: Scheduler,
  tag: string,
  label: string,
): Op<never, string, []> {
  return Op.try(() => s.schedule(Promise.resolve(tag), label)).flatMap((error: string) =>
    Op.fail(error),
  );
}

export function anyOkOpFromScheduledBranch(
  s: Scheduler,
  value: number,
  label: string,
): Op<number, never, []> {
  return Op.try(() => s.schedule(Promise.resolve(value), label));
}

export function pendingUntilAbortOp(
  s: Scheduler,
  label: string,
  onAbort: () => void,
): Op<number, never, []> {
  return Op.try((signal) => {
    const task = new Promise<number>((resolve) => {
      signal.addEventListener("abort", () => {
        onAbort();
        resolve(-1);
      });
    });
    return s.schedule(task, label);
  });
}

export function firstSuccessAnyBranchIndex(
  report: SchedulerReportItem[],
  prefix: string,
  branches: readonly SchedulerAnyBranch[],
): number | undefined {
  for (const item of report) {
    const index = parseBranchIndex(item.label, prefix);
    if (index === undefined || index >= branches.length) continue;
    if (item.status !== "resolved") continue;
    if (branches[index]?.kind === "ok") {
      return index;
    }
  }

  return undefined;
}
