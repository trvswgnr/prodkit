import { describe, test, expect, assert } from "vitest";
import ts from "typescript";
import {
  createPackageProgram,
  getPackageRoot,
  getPackageSourceFiles,
  symbolHasDocs,
  symbolHasExample,
} from "./support.js";

describe("Op API JSDoc coverage", () => {
  const packageRoot = getPackageRoot();
  const program = createPackageProgram(packageRoot);
  const checker = program.getTypeChecker();
  const indexSource = program.getSourceFile(`${packageRoot}/src/index.ts`);
  assert(indexSource, "Expected src/index.ts in TypeScript program");
  const indexModule = checker.getSymbolAtLocation(indexSource);
  assert(indexModule, "Expected module symbol for src/index.ts");
  const opExport = checker.getExportsOfModule(indexModule).find((symbol) => symbol.name === "Op");
  assert(opExport, "Expected Op export in src/index.ts");
  const opValueDeclaration = opExport.valueDeclaration ?? opExport.declarations?.[0];

  test("all static methods are documented with JSDoc", () => {
    assert(opValueDeclaration, "Expected Op declaration in src/index.ts");
    const opFactoryType = checker.getTypeOfSymbolAtLocation(opExport, opValueDeclaration);

    const propertyNames = opFactoryType.getProperties().map((p) => p.name);
    const documented = propertyNames.filter((name) =>
      symbolHasDocs(checker, opFactoryType.getProperty(name)),
    );
    expect(documented).toEqual(propertyNames);
  });

  test("all static methods include @example", () => {
    assert(opValueDeclaration, "Expected Op declaration in src/index.ts");
    const opFactoryType = checker.getTypeOfSymbolAtLocation(opExport, opValueDeclaration);

    const staticMethodNames = opFactoryType
      .getProperties()
      .filter((property) => {
        const propertyType = checker.getTypeOfSymbolAtLocation(property, opValueDeclaration);
        return propertyType.getCallSignatures().length > 0;
      })
      .map((property) => property.name);
    const withExamples = staticMethodNames.filter((name) =>
      symbolHasExample(checker, opFactoryType.getProperty(name)),
    );

    expect(withExamples).toEqual(staticMethodNames);
  });

  test("all instance methods are documented with JSDoc", () => {
    assert(opValueDeclaration, "Expected Op declaration in src/index.ts");
    const opFactoryType = checker.getTypeOfSymbolAtLocation(opExport, opValueDeclaration);
    const opOfSymbol = opFactoryType.getProperty("of");
    assert(opOfSymbol, "Expected Op.of on Op factory type");

    const opOfType = checker.getTypeOfSymbolAtLocation(opOfSymbol, opValueDeclaration);
    const opOfSignature = opOfType.getCallSignatures()[0];
    assert(opOfSignature, "Expected call signature for Op.of");

    const opInstanceType = checker.getReturnTypeOfSignature(opOfSignature);
    const instanceMethodNames = opInstanceType
      .getProperties()
      .filter((property) => {
        if (property.name.startsWith("__@")) return false;
        const propertyType = checker.getTypeOfSymbolAtLocation(property, opValueDeclaration);
        return propertyType.getCallSignatures().length > 0;
      })
      .map((property) => property.name);
    const documented = instanceMethodNames.filter((name) =>
      symbolHasDocs(checker, opInstanceType.getProperty(name)),
    );

    expect(documented).toEqual(instanceMethodNames);
  });

  test("all instance methods include @example", () => {
    assert(opValueDeclaration, "Expected Op declaration in src/index.ts");
    const opFactoryType = checker.getTypeOfSymbolAtLocation(opExport, opValueDeclaration);
    const opOfSymbol = opFactoryType.getProperty("of");
    assert(opOfSymbol, "Expected Op.of on Op factory type");

    const opOfType = checker.getTypeOfSymbolAtLocation(opOfSymbol, opValueDeclaration);
    const opOfSignature = opOfType.getCallSignatures()[0];
    assert(opOfSignature, "Expected call signature for Op.of");

    const opInstanceType = checker.getReturnTypeOfSignature(opOfSignature);
    const instanceMethodNames = opInstanceType
      .getProperties()
      .filter((property) => {
        if (property.name.startsWith("__@")) return false;
        const propertyType = checker.getTypeOfSymbolAtLocation(property, opValueDeclaration);
        return propertyType.getCallSignatures().length > 0;
      })
      .map((property) => property.name);
    const withExamples = instanceMethodNames.filter((name) =>
      symbolHasExample(checker, opInstanceType.getProperty(name)),
    );

    expect(withExamples).toEqual(instanceMethodNames);
  });
});

describe("unsafeCoerce documentation", () => {
  const packageRoot = getPackageRoot();
  const program = createPackageProgram(packageRoot);
  const sourceFiles = getPackageSourceFiles(program, packageRoot);

  test("all unsafeCoerce calls are preceded by a SAFETY comment", () => {
    type Violation = {
      message: string;
      location: string;
    };
    const violations: Violation[] = [];

    const hasPrecedingSafetyComment = (
      lines: readonly string[],
      callLine0Based: number,
    ): boolean => {
      let i = callLine0Based - 1;
      while (i >= 0) {
        const trimmed = lines[i]?.trim() ?? "";
        if (trimmed === "") {
          i -= 1;
          continue;
        }
        if (trimmed.startsWith("//")) {
          if (trimmed.startsWith("// SAFETY:")) {
            return true;
          }
          i -= 1;
          continue;
        }
        return false;
      }
      return false;
    };

    const isValidFormatting = (
      sourceFile: ts.SourceFile,
      node: ts.CallExpression,
      lines: readonly string[],
    ): boolean => {
      const start = node.getStart(sourceFile);
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
      const lineText = lines[line] ?? "";
      const prefix = lineText.slice(0, character);
      if (/^(\s|\.\.\.)*$/.test(prefix)) {
        return true;
      }
      return character > 0 && lineText.charAt(character - 1) === " ";
    };

    for (const sourceFile of sourceFiles) {
      const lines = sourceFile.text.split(/\r?\n/);

      const visit = (node: ts.Node): void => {
        if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
          return ts.forEachChild(node, visit);
        }
        const callName = node.expression.text;
        if (callName !== "unsafeCoerce") {
          return ts.forEachChild(node, visit);
        }

        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const relativePath = sourceFile.fileName.slice(packageRoot.length + 1);
        if (!hasPrecedingSafetyComment(lines, line)) {
          violations.push({
            message: `missing '// SAFETY:' comment`,
            location: `${relativePath}:${line + 1}`,
          });
        }

        if (!isValidFormatting(sourceFile, node, lines)) {
          violations.push({
            message: `unsafeCoerce must be alone after indent or preceded by either a space or '...'`,
            location: `${relativePath}:${line + 1}`,
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
