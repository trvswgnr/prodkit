import { describe, test, expect } from "vitest";
import ts from "typescript";
import {
  createPackageProgram,
  formatHygieneViolations,
  getPackageRoot,
  getSourceFile,
  nodeLocation,
  type HygieneViolation,
} from "./support.js";

/**
 * Runtime paths that construct ops or bind callback returns must not infer nullary vs
 * parameterized arity from function reflection (for example `fn.length`).
 */
const ARITY_GUARD_FILES = [
  "src/builders.ts",
  "src/shared.ts",
  "src/core/plan/shell.ts",
  "src/core/plan/transforms.ts",
  "src/core/fluent.ts",
  "src/di/plan.ts",
] as const;

function isFunctionLikeType(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.flags & ts.TypeFlags.Any) {
    return false;
  }

  if (type.isUnionOrIntersection()) {
    return type.types.some((member) => isFunctionLikeType(member, checker));
  }

  if (type.getCallSignatures().length > 0) {
    return true;
  }

  const symbol = type.getSymbol() ?? type.aliasSymbol;
  return symbol?.getName() === "Function";
}

function isAllowedLengthReceiver(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral | ts.TypeFlags.Number)) {
    return true;
  }

  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return true;
  }

  const symbol = type.getSymbol() ?? type.aliasSymbol;
  const name = symbol?.getName();
  if (name === "Array" || name === "ReadonlyArray") {
    return true;
  }

  if (type.isUnionOrIntersection()) {
    return type.types.every((member) => isAllowedLengthReceiver(member, checker));
  }

  return false;
}

function collectArityViolations(program: ts.Program, packageRoot: string): HygieneViolation[] {
  const checker = program.getTypeChecker();
  const violations: HygieneViolation[] = [];

  const report = (node: ts.Node, sourceFile: ts.SourceFile, message: string) => {
    violations.push({
      ...nodeLocation(sourceFile, node, packageRoot),
      message,
    });
  };

  const inspectLengthAccess = (
    receiver: ts.Expression,
    sourceFile: ts.SourceFile,
    detail: string,
  ) => {
    const type = checker.getTypeAtLocation(receiver);
    if (isAllowedLengthReceiver(type, checker)) {
      return;
    }
    if (isFunctionLikeType(type, checker)) {
      report(
        receiver,
        sourceFile,
        `${detail}: function arity must not be read via .length in op construction or callback binding paths`,
      );
    }
  };

  for (const relativePath of ARITY_GUARD_FILES) {
    const sourceFile = getSourceFile(program, packageRoot, relativePath);

    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "length") {
        inspectLengthAccess(node.expression, sourceFile, "PropertyAccessExpression.length");
      }

      if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "length"
      ) {
        inspectLengthAccess(node.expression, sourceFile, "ElementAccessExpression['length']");
      }

      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const [firstArg, secondArg] = node.arguments;

        if (
          firstArg &&
          secondArg &&
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === "Reflect" &&
          callee.name.text === "get" &&
          node.arguments.length === 2 &&
          ts.isStringLiteralLike(secondArg) &&
          secondArg.text === "length"
        ) {
          inspectLengthAccess(firstArg, sourceFile, "Reflect.get(..., 'length')");
        }

        if (
          firstArg &&
          secondArg &&
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === "Object" &&
          callee.name.text === "getOwnPropertyDescriptor" &&
          node.arguments.length === 2 &&
          ts.isStringLiteralLike(secondArg) &&
          secondArg.text === "length"
        ) {
          inspectLengthAccess(
            firstArg,
            sourceFile,
            "Object.getOwnPropertyDescriptor(..., 'length')",
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return violations;
}

describe("op construction arity hygiene", () => {
  const packageRoot = getPackageRoot();
  const program = createPackageProgram(packageRoot);

  test("op construction and callback binding paths do not use function .length for arity", () => {
    const violations = collectArityViolations(program, packageRoot);

    expect(
      violations,
      violations.length > 0 ? formatHygieneViolations(violations) : undefined,
    ).toEqual([]);
  });
});
