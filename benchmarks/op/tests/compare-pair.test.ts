import { describe, expect, it } from "vitest";
import { libraryPairOutcome } from "../runtime/comparison-matrix.ts";
import { parseLibraryPairArg } from "../cli/compare.ts";
import {
  benchRunOptionSummary,
  parseBenchRunOptions,
  resolveBenchRunOptions,
} from "../runtime/harness.ts";

describe("parseLibraryPairArg", () => {
  it("parses a valid library pair", () => {
    expect(parseLibraryPairArg(["--pair=op,effect"])).toEqual({
      left: "op",
      right: "effect",
    });
  });

  it("trims whitespace around ids", () => {
    expect(parseLibraryPairArg(["--pair= op , effect "])).toEqual({
      left: "op",
      right: "effect",
    });
  });

  it("returns undefined when --pair is omitted", () => {
    expect(parseLibraryPairArg([])).toBeUndefined();
  });

  it("rejects native baseline pairs", () => {
    expect(() => parseLibraryPairArg(["--pair=native,op"])).toThrow(
      "--pair compares libraries directly",
    );
  });

  it("rejects duplicate ids", () => {
    expect(() => parseLibraryPairArg(["--pair=op,op"])).toThrow("two different implementation ids");
  });

  it("rejects unknown ids", () => {
    expect(() => parseLibraryPairArg(["--pair=op,neverthrow"])).toThrow("Expected ids from:");
  });
});

describe("libraryPairOutcome", () => {
  it("returns the faster library and margin >= 1", () => {
    expect(libraryPairOutcome("op", 100, "effect", 250)).toEqual({
      faster: "effect",
      margin: 2.5,
    });
    expect(libraryPairOutcome("op", 300, "effect", 100)).toEqual({
      faster: "op",
      margin: 3,
    });
  });
});

describe("parseBenchRunOptions", () => {
  it("parses local benchmark timing flags", () => {
    expect(
      parseBenchRunOptions([
        "--time=1000",
        "--warmup-time=500",
        "--warmup-iterations=10",
        "--repeats=3",
      ]),
    ).toEqual({
      time: 1000,
      warmupTime: 500,
      warmupIterations: 10,
      repeats: 3,
    });
  });

  it("resolves defaults for omitted timing flags", () => {
    expect(resolveBenchRunOptions({})).toEqual({
      time: 300,
      warmupTime: 150,
      warmupIterations: 5,
      repeats: 1,
    });
  });

  it("rejects non-positive timing flags", () => {
    expect(() => parseBenchRunOptions(["--repeats=0"])).toThrow("Invalid repeats");
  });

  it("prints a concise timing summary", () => {
    expect(benchRunOptionSummary({ time: 1000, repeats: 2 })).toBe(
      "time=1000ms warmupTime=150ms warmupIterations=5 repeats=2",
    );
  });
});
