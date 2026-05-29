import { describe, expect, it } from "vitest";
import { libraryPairOutcome } from "../comparison-matrix.ts";
import { parseLibraryPairArg } from "../compare.ts";

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
