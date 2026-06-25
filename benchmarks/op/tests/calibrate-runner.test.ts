import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALIBRATION_SAMPLE_COUNT,
  DEFAULT_MICROBENCHMARK_NOISE_THRESHOLD_RATIO,
  DEFAULT_WORKFLOW_NOISE_THRESHOLD_RATIO,
  createBenchmarkCalibrationReport,
  createCalibrationRecommendation,
  parseRunnerCalibrationArgs,
  summarizeCalibrationScenario,
} from "../cli/calibrate-runner.ts";
import type { RepeatedTinybenchRecord } from "../runtime/harness.ts";

function stats(hz: number, rme = 1): RepeatedTinybenchRecord {
  return {
    hz,
    latencyMs: 1,
    latencyMinMs: 0.9,
    latencyMaxMs: 1.1,
    semMs: 0.01,
    rme,
    sampleCount: 100,
  };
}

describe("parseRunnerCalibrationArgs", () => {
  it("uses benchmark defaults and the calibration report path", () => {
    expect(parseRunnerCalibrationArgs([])).toEqual({
      reportPath: "op/.artifacts/runner-calibration-report.json",
      benchOptions: {
        time: undefined,
        warmupTime: undefined,
        warmupIterations: undefined,
        repeats: undefined,
      },
      sampleCount: DEFAULT_CALIBRATION_SAMPLE_COUNT,
      thresholds: {
        microbenchmarkNoiseRatio: DEFAULT_MICROBENCHMARK_NOISE_THRESHOLD_RATIO,
        workflowNoiseRatio: DEFAULT_WORKFLOW_NOISE_THRESHOLD_RATIO,
      },
    });
  });

  it("parses calibration controls and bench timing", () => {
    expect(
      parseRunnerCalibrationArgs([
        "--report=op/.artifacts/custom-calibration.json",
        "--samples=5",
        "--micro-threshold=0.03",
        "--workflow-threshold=0.12",
        "--time=1000",
        "--warmup-time=500",
        "--warmup-iterations=10",
        "--repeats=3",
      ]),
    ).toEqual({
      reportPath: "op/.artifacts/custom-calibration.json",
      benchOptions: {
        time: 1000,
        warmupTime: 500,
        warmupIterations: 10,
        repeats: 3,
      },
      sampleCount: 5,
      thresholds: {
        microbenchmarkNoiseRatio: 0.03,
        workflowNoiseRatio: 0.12,
      },
    });
  });
});

describe("runner calibration summaries", () => {
  it("summarizes per-scenario observed noise", () => {
    const summary = summarizeCalibrationScenario({
      key: "singleValue",
      label: "Single value",
      benchName: "singleValue.opRun",
      samples: [
        {
          sampleIndex: 0,
          first: "left",
          left: stats(100, 1),
          right: stats(102, 1),
        },
        {
          sampleIndex: 1,
          first: "right",
          left: stats(100, 2),
          right: stats(109, 2),
        },
        {
          sampleIndex: 2,
          first: "left",
          left: stats(100, 1),
          right: stats(105, 1),
        },
      ],
    });

    expect(summary.sampleCount).toBe(3);
    expect(summary.medianAbsoluteDeltaRatio).toBeCloseTo(0.05);
    expect(summary.maxAbsoluteDeltaRatio).toBeCloseTo(0.09);
    expect(summary.noiseBandRatio).toBeCloseTo(0.09);
    expect(summary.samples.map((sample) => sample.first)).toEqual(["left", "right", "left"]);
  });

  it("recommends noisy when the worst scenario exceeds a threshold", () => {
    const summary = summarizeCalibrationScenario({
      key: "retry",
      label: "Retry loop",
      benchName: "retry.opWithPolicyRetry",
      samples: [
        {
          sampleIndex: 0,
          first: "left",
          left: stats(100),
          right: stats(112),
        },
      ],
    });

    const microbenchmark = createCalibrationRecommendation([summary], 0.05);
    const workflow = createCalibrationRecommendation([summary], 0.15);

    expect(microbenchmark).toMatchObject({
      decision: "noisy",
      worstScenarioKey: "retry",
    });
    expect(microbenchmark.worstNoiseBandRatio).toBeCloseTo(0.12);
    expect(workflow).toMatchObject({
      decision: "acceptable",
      worstScenarioKey: "retry",
    });
    expect(workflow.worstNoiseBandRatio).toBeCloseTo(0.12);
  });

  it("creates a calibration report with both decision classes", () => {
    const summary = summarizeCalibrationScenario({
      key: "all",
      label: "Parallel batch",
      benchName: "all.opAll",
      samples: [
        {
          sampleIndex: 0,
          first: "left",
          left: stats(100),
          right: stats(108),
        },
      ],
    });

    const report = createBenchmarkCalibrationReport({
      generatedAt: "2026-06-23T12:00:00.000Z",
      repoRoot: process.cwd(),
      packageDir: process.cwd(),
      packageVersion: "0.2.2",
      benchOptions: {
        time: 300,
        warmupTime: 150,
        warmupIterations: 5,
        repeats: 1,
      },
      sampleCount: 1,
      thresholds: {
        microbenchmarkNoiseRatio: 0.05,
        workflowNoiseRatio: 0.1,
      },
      scenarioSummaries: [summary],
    });

    expect(report.recommendations.microbenchmark.decision).toBe("noisy");
    expect(report.recommendations.workflow.decision).toBe("acceptable");
  });
});
