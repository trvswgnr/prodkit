import { describe, expect, test, vi } from "vitest";
import { raceInFlightAfterInterrupt } from "../../../src/execution/abort-settlement.js";

describe("raceInFlightAfterInterrupt", () => {
  test("resolves when in-flight work completes during the cooperative window", async () => {
    vi.useFakeTimers();
    try {
      const inFlight = new Promise<string>((resolve) => {
        queueMicrotask(() => resolve("done"));
      });

      const raced = raceInFlightAfterInterrupt(inFlight, "abort");

      await vi.runAllTimersAsync();
      await expect(raced).resolves.toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects with abort reason when in-flight work ignores interrupt", async () => {
    vi.useFakeTimers();
    try {
      const inFlight = new Promise<string>(() => {});
      const raced = raceInFlightAfterInterrupt(inFlight, "abort-reason");
      const outcome = expect(raced).rejects.toBe("abort-reason");

      await vi.runAllTimersAsync();
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });
});
