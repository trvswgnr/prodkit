import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { describe, expect, test } from "vitest";
import { clearOpTypeDetectorCaches, createOpTypeDetector } from "./op-type-detector.js";
import {
  setupTempDetectorProject,
  setupTempOpLintProject,
  writeDefaultTsConfig,
} from "./test-support/op-lint-fixture.js";

function findMemberCallRange(
  sourceFile: ts.SourceFile,
  objectName: string,
  methodName: string,
): [number, number] {
  let range: [number, number] | undefined;

  const visit = (node: ts.Node) => {
    if (range !== undefined) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === objectName &&
      node.expression.name.text === methodName
    ) {
      range = [node.getStart(sourceFile), node.getEnd()];
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (range === undefined) {
    throw new Error(`Call expression ${objectName}.${methodName}(...) not found`);
  }

  return range;
}

function findIdentifierExpressionRange(sourceFile: ts.SourceFile, name: string): [number, number] {
  let range: [number, number] | undefined;

  const visit = (node: ts.Node) => {
    if (range !== undefined) return;
    if (
      ts.isIdentifier(node) &&
      node.text === name &&
      ts.isExpressionStatement(node.parent) &&
      node.parent.expression === node
    ) {
      range = [node.getStart(sourceFile), node.getEnd()];
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (range === undefined) {
    throw new Error(`Identifier expression ${name} not found`);
  }

  return range;
}

function findCallCalleeRange(sourceFile: ts.SourceFile, name: string): [number, number] {
  let range: [number, number] | undefined;

  const visit = (node: ts.Node) => {
    if (range !== undefined) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      range = [node.expression.getStart(sourceFile), node.expression.getEnd()];
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (range === undefined) {
    throw new Error(`Call callee ${name}(...) not found`);
  }

  return range;
}

function isOpCall(source: string, objectName: string, methodName: string): boolean {
  clearOpTypeDetectorCaches();
  const project = setupTempDetectorProject(source);
  const { tempDir, filePath } = project;

  try {
    const detector = createOpTypeDetector({
      cwd: tempDir,
      filename: filePath,
      physicalFilename: filePath,
      sourceCode: { text: source },
    });
    expect(detector).toBeDefined();

    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true);
    const range = findMemberCallRange(sourceFile, objectName, methodName);
    return detector?.isOpExpression({ range }) ?? false;
  } finally {
    project.cleanup();
  }
}

function isOpFactoryCallee(source: string, calleeName: string): boolean {
  clearOpTypeDetectorCaches();
  const project = setupTempDetectorProject(source);
  const { tempDir, filePath } = project;

  try {
    const detector = createOpTypeDetector({
      cwd: tempDir,
      filename: filePath,
      physicalFilename: filePath,
      sourceCode: { text: source },
    });
    expect(detector).toBeDefined();

    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true);
    const range = findCallCalleeRange(sourceFile, calleeName);
    return detector?.isOpFactoryExpression({ range }) ?? false;
  } finally {
    project.cleanup();
  }
}

describe("op-type-detector Op factory identity", () => {
  test("recognizes an aliased Op factory", () => {
    const source = [
      'import { Op as Operation } from "@prodkit/op";',
      "",
      "const program = Operation(function* () {",
      "  return yield* Operation.of(1);",
      "});",
      "",
      "void program;",
      "",
    ].join("\n");

    expect(isOpFactoryCallee(source, "Operation")).toBe(true);
  });

  test("does not recognize a local OpFactory lookalike", () => {
    const source = [
      'const Operation = Object.assign((gen: unknown) => gen, { _tag: "OpFactory" as const });',
      "",
      "const program = Operation(function* () {",
      "  return 1;",
      "});",
      "",
      "void program;",
      "",
    ].join("\n");

    expect(isOpFactoryCallee(source, "Operation")).toBe(false);
  });
});

describe("op-type-detector Console wrapper", () => {
  test("recognizes service.load()", () => {
    const source = [
      'import { Op, type Op as OpType } from "@prodkit/op";',
      "",
      "declare const service: {",
      "  load(): OpType<number, never, []>;",
      "};",
      "",
      "const program = Op(function* () {",
      "  service.load();",
      "});",
      "",
      "void program;",
      "",
    ].join("\n");

    expect(isOpCall(source, "service", "load")).toBe(true);
  });

  test("recognizes Console.info() returning Op from wrapper function", () => {
    const source = [
      'import { Op } from "@prodkit/op";',
      "",
      "const Console = {",
      "  info: (...args: unknown[]) => Op.of(undefined).tap(() => console.info(...args)),",
      "};",
      "",
      "const divide = Op(function* (a: number, b: number) {",
      '  Console.info("divide", a, b);',
      "  return a / b;",
      "});",
      "",
      "void divide;",
      "",
    ].join("\n");

    expect(isOpCall(source, "Console", "info")).toBe(true);
  });

  test("recognizes mapped console wrapper with satisfies", () => {
    const source = [
      'import { Op, type Op as OpType } from "@prodkit/op";',
      "",
      'const levels = ["info", "warn", "error"] as const;',
      "type ConsoleOps = Record<(typeof levels)[number], (...args: unknown[]) => OpType<void, never, []>>;",
      "",
      "const Console = Object.fromEntries(",
      "  levels.map((level) => [",
      "    level,",
      "    (...args: unknown[]) => Op.of(undefined).tap(() => console[level](...args)),",
      "  ]),",
      ") as ConsoleOps;",
      "",
      "const divide = Op(function* (a: number, b: number) {",
      '  Console.info("divide", a, b);',
      "  return a / b;",
      "});",
      "",
      "void divide;",
      "",
    ].join("\n");

    expect(isOpCall(source, "Console", "info")).toBe(true);
  });

  test("recognizes calling an Op stored on a mapped console object", () => {
    const source = [
      'import { Op } from "@prodkit/op";',
      "",
      'const levels = ["info", "warn", "error"] as const;',
      "",
      "const Console = Object.fromEntries(",
      "  levels.map((level) => [",
      "    level,",
      "    Op(function* (...args: unknown[]) {",
      "      console[level](...args);",
      "    }),",
      "  ]),",
      ");",
      "",
      "const divide = Op(function* (a: number, b: number) {",
      '  Console.info("divide", a, b);',
      "  return a / b;",
      "});",
      "",
      "void divide;",
      "",
    ].join("\n");

    expect(isOpCall(source, "Console", "info")).toBe(true);
  });

  test("recognizes Console.info imported from another module", () => {
    clearOpTypeDetectorCaches();
    const project = setupTempOpLintProject("op-lint-detector-");
    const { tempDir } = project;

    try {
      writeDefaultTsConfig(project);
      project.writeFile(
        "console.ts",
        [
          'import { Op } from "@prodkit/op";',
          "",
          "export const Console = {",
          "  info: (...args: unknown[]) => Op.of(undefined).tap(() => console.info(...args)),",
          "};",
          "",
        ].join("\n"),
      );

      const divideSource = [
        'import { Op } from "@prodkit/op";',
        'import { Console } from "./console.js";',
        "",
        "const divide = Op(function* (a: number, b: number) {",
        '  Console.info("divide", a, b);',
        "  return a / b;",
        "});",
        "",
        "void divide;",
        "",
      ].join("\n");

      const filePath = project.writeFile("divide.ts", divideSource);

      const detector = createOpTypeDetector({
        cwd: tempDir,
        filename: filePath,
        physicalFilename: filePath,
        sourceCode: { text: divideSource },
      });
      expect(detector).toBeDefined();

      const sourceFile = ts.createSourceFile(filePath, divideSource, ts.ScriptTarget.ES2022, true);
      const range = findMemberCallRange(sourceFile, "Console", "info");
      expect(detector?.isOpExpression({ range })).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  test("does not recognize console wrapper typed as unknown record", () => {
    const source = [
      'import { Op } from "@prodkit/op";',
      "",
      "function createConsole(): Record<string, (...args: unknown[]) => unknown> {",
      "  return {",
      "    info: (...args: unknown[]) => Op.of(undefined).tap(() => console.info(...args)),",
      "  };",
      "}",
      "",
      "const Console = createConsole();",
      "",
      "const divide = Op(function* (a: number, b: number) {",
      '  Console.info("divide", a, b);',
      "  return a / b;",
      "});",
      "",
      "void divide;",
      "",
    ].join("\n");

    expect(isOpCall(source, "Console", "info")).toBe(false);
  });

  test("recognizes explicitly typed console wrapper methods", () => {
    const source = [
      'import { Op, type Op as OpType } from "@prodkit/op";',
      "",
      "type ConsoleOps = {",
      "  info(...args: unknown[]): OpType<void, never, []>;",
      "};",
      "",
      "const Console: ConsoleOps = {",
      "  info: (...args) => Op.of(undefined).tap(() => console.info(...args)),",
      "};",
      "",
      "const divide = Op(function* (a: number, b: number) {",
      '  Console.info("divide", a, b);',
      "  return a / b;",
      "});",
      "",
      "void divide;",
      "",
    ].join("\n");

    expect(isOpCall(source, "Console", "info")).toBe(true);
  });

  test("recognizes Console.info() when info is a callable Op", () => {
    const source = [
      'import { Op } from "@prodkit/op";',
      "",
      "const Console = {",
      "  info: Op(function* (msg: string, ...args: unknown[]) {",
      "    console.info(msg, ...args);",
      "  }),",
      "};",
      "",
      "const divide = Op(function* (a: number, b: number) {",
      '  Console.info("divide", a, b);',
      "  return a / b;",
      "});",
      "",
      "void divide;",
      "",
    ].join("\n");

    expect(isOpCall(source, "Console", "info")).toBe(true);
  });

  test("recognizes Console.info when lint ranges differ slightly from TypeScript offsets", () => {
    clearOpTypeDetectorCaches();
    const project = setupTempDetectorProject(
      [
        'import { Op } from "@prodkit/op";',
        "",
        "const Console = {",
        "  info: (...args: unknown[]) => Op.of(undefined).tap(() => console.info(...args)),",
        "};",
        "",
        "const divide = Op(function* (a: number, b: number) {",
        '  Console.info("divide", a, b);',
        "  return a / b;",
        "});",
        "",
        "void divide;",
        "",
      ].join("\n"),
    );
    const { tempDir, filePath } = project;

    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        readFileSync(filePath, "utf8"),
        ts.ScriptTarget.ES2022,
        true,
      );
      const [start, end] = findMemberCallRange(sourceFile, "Console", "info");
      const shiftedRange: [number, number] = [start + 1, end - 1];

      const detector = createOpTypeDetector({
        cwd: tempDir,
        filename: filePath,
        physicalFilename: filePath,
        sourceCode: { text: readFileSync(filePath, "utf8") },
      });
      expect(detector?.isOpExpression({ range: shiftedRange })).toBe(true);
    } finally {
      project.cleanup();
    }
  });
});

describe("op-type-detector source cache", () => {
  test("uses the current lint source for an existing file", () => {
    clearOpTypeDetectorCaches();
    const originalSource = [
      'import { Op } from "@prodkit/op";',
      "",
      "const value = Op.of(1);",
      "",
      "const program = Op(function* () {",
      "  value;",
      "});",
      "",
      "void program;",
      "",
    ].join("\n");
    const updatedSource = [
      'import { Op } from "@prodkit/op";',
      "",
      "const value = 1 + 2;",
      "",
      "const program = Op(function* () {",
      "  value;",
      "});",
      "",
      "void program;",
      "",
    ].join("\n");
    const project = setupTempDetectorProject(originalSource);
    const { tempDir, filePath } = project;

    try {
      const originalDetector = createOpTypeDetector({
        cwd: tempDir,
        filename: filePath,
        physicalFilename: filePath,
        sourceCode: { text: originalSource },
      });
      expect(originalDetector).toBeDefined();

      const originalSourceFile = ts.createSourceFile(
        filePath,
        originalSource,
        ts.ScriptTarget.ES2022,
        true,
      );
      expect(
        originalDetector?.isOpExpression({
          range: findIdentifierExpressionRange(originalSourceFile, "value"),
        }),
      ).toBe(true);

      const updatedDetector = createOpTypeDetector({
        cwd: tempDir,
        filename: filePath,
        physicalFilename: filePath,
        sourceCode: { text: updatedSource },
      });
      expect(updatedDetector).toBeDefined();

      const updatedSourceFile = ts.createSourceFile(
        filePath,
        updatedSource,
        ts.ScriptTarget.ES2022,
        true,
      );
      expect(
        updatedDetector?.isOpExpression({
          range: findIdentifierExpressionRange(updatedSourceFile, "value"),
        }),
      ).toBe(false);
    } finally {
      project.cleanup();
    }
  });
});

describe("op-type-detector quick start returns", () => {
  const quickStartSource = [
    'import { Op } from "@prodkit/op";',
    'import { TaggedError } from "better-result";',
    "",
    'class DivisionByZeroError extends TaggedError("DivisionByZeroError")() {}',
    "",
    "const divide = Op(function* (a: number, b: number) {",
    "  if (b === 0) return yield* new DivisionByZeroError();",
    "  return a / b;",
    "});",
    "",
    "const sqrt = Op(function* (n: number) {",
    '  if (n < 0) return yield* Op.fail("Negative");',
    "  return Math.sqrt(n);",
    "});",
    "",
    "const program = Op(function* () {",
    "  const quotient = yield* divide(10, 2);",
    "  const rooted = yield* sqrt(quotient);",
    "  return rooted * 2;",
    "});",
    "",
    "void program;",
    "",
  ].join("\n");

  function returnArgumentRanges(sourceFile: ts.SourceFile): Map<string, [number, number]> {
    const ranges = new Map<string, [number, number]>();

    const visit = (node: ts.Node) => {
      if (ts.isReturnStatement(node) && node.expression !== undefined) {
        const text = node.expression.getText(sourceFile);
        ranges.set(text, [node.expression.getStart(sourceFile), node.expression.getEnd()]);
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return ranges;
  }

  test("does not treat plain success returns as Ops", () => {
    clearOpTypeDetectorCaches();
    const project = setupTempDetectorProject(quickStartSource);
    const { tempDir, filePath } = project;

    try {
      const detector = createOpTypeDetector({
        cwd: tempDir,
        filename: filePath,
        physicalFilename: filePath,
        sourceCode: { text: quickStartSource },
      });
      expect(detector).toBeDefined();

      const sourceFile = ts.createSourceFile(
        filePath,
        quickStartSource,
        ts.ScriptTarget.ES2022,
        true,
      );
      const ranges = returnArgumentRanges(sourceFile);

      for (const expression of ["a / b", "Math.sqrt(n)", "rooted * 2"]) {
        const range = ranges.get(expression);
        expect(range, expression).toBeDefined();
        if (range === undefined) continue;
        expect(detector?.isOpExpression({ range }), expression).toBe(false);
      }
    } finally {
      project.cleanup();
    }
  });

  test("does not treat plain success returns as Ops when ranges are slightly shifted", () => {
    clearOpTypeDetectorCaches();
    const project = setupTempDetectorProject(quickStartSource);
    const { tempDir, filePath } = project;

    try {
      const detector = createOpTypeDetector({
        cwd: tempDir,
        filename: filePath,
        physicalFilename: filePath,
        sourceCode: { text: quickStartSource },
      });
      expect(detector).toBeDefined();

      const sourceFile = ts.createSourceFile(
        filePath,
        quickStartSource,
        ts.ScriptTarget.ES2022,
        true,
      );
      const ranges = returnArgumentRanges(sourceFile);

      for (const expression of ["a / b", "Math.sqrt(n)", "rooted * 2"]) {
        const range = ranges.get(expression);
        expect(range, expression).toBeDefined();
        if (range === undefined) continue;
        const [start, end] = range;
        const shiftedRange: [number, number] = [start + 1, end - 1];
        expect(detector?.isOpExpression({ range: shiftedRange }), expression).toBe(false);
      }
    } finally {
      project.cleanup();
    }
  });
});
