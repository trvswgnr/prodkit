import { describe, test, expect, assert } from "vitest";
import ts from "typescript";

function createProgram(packageRoot: string): ts.Program {
  const tsconfigPath = `${packageRoot}/tsconfig.json`;
  const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, packageRoot);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

function moduleExports(program: ts.Program, packageRoot: string, entryPath: string): ts.Symbol[] {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(`${packageRoot}/${entryPath}`);
  assert(source, `Expected ${entryPath} in TypeScript program`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  assert(moduleSymbol, `Expected module symbol for ${entryPath}`);
  return checker.getExportsOfModule(moduleSymbol);
}

function symbolHasDocs(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): boolean {
  if (!symbol) return false;
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return (
    resolved.getDocumentationComment(checker).length > 0 ||
    resolved.getJsDocTags(checker).length > 0
  );
}

function expectDocumented(checker: ts.TypeChecker, symbols: ts.Symbol[], names: string[]): void {
  const documented = names.filter((name) => {
    const symbol = symbols.find((candidate) => candidate.name === name);
    return symbolHasDocs(checker, symbol);
  });
  expect(documented).toEqual(names);
}

describe("@prodkit/op/policy JSDoc coverage", () => {
  const packageRoot = ts.sys.getCurrentDirectory();
  const program = createProgram(packageRoot);
  const checker = program.getTypeChecker();
  const exports = moduleExports(program, packageRoot, "src/policy/index.ts");

  test("policy constructors are documented", () => {
    const policySymbol = exports.find((symbol) => symbol.name === "Policy");
    assert(policySymbol, "Expected Policy export");
    const policyDeclaration = policySymbol.valueDeclaration ?? policySymbol.declarations?.[0];
    assert(policyDeclaration, "Expected Policy declaration");
    const policyType = checker.getTypeOfSymbolAtLocation(policySymbol, policyDeclaration);
    expectDocumented(checker, policyType.getProperties(), [
      "retry",
      "timeout",
      "cancel",
      "release",
      "define",
    ]);
  });

  test("Delay helpers are documented", () => {
    const delaySymbol = exports.find((symbol) => symbol.name === "Delay");
    assert(delaySymbol, "Expected Delay export");
    const delayDeclaration = delaySymbol.valueDeclaration ?? delaySymbol.declarations?.[0];
    assert(delayDeclaration, "Expected Delay declaration");
    const delayType = checker.getTypeOfSymbolAtLocation(delaySymbol, delayDeclaration);
    const helperNames = delayType
      .getProperties()
      .map((property) => property.name)
      .filter((name) => !name.startsWith("__"));
    const documented = helperNames.filter((name) =>
      symbolHasDocs(checker, delayType.getProperty(name)),
    );
    expect(documented).toEqual(helperNames);
  });

  test("retry policy types are documented", () => {
    expectDocumented(checker, exports, ["RetryPolicy", "RetryDelay", "ExponentialDelayOptions"]);
  });
});

describe("@prodkit/op/hkt JSDoc coverage", () => {
  const packageRoot = ts.sys.getCurrentDirectory();
  const program = createProgram(packageRoot);
  const checker = program.getTypeChecker();
  const exports = moduleExports(program, packageRoot, "src/hkt.ts");

  test("HKT symbols and types are documented", () => {
    expectDocumented(checker, exports, ["HKT"]);
  });
});

describe("@prodkit/op/di JSDoc coverage", () => {
  const packageRoot = ts.sys.getCurrentDirectory();
  const program = createProgram(packageRoot);
  const checker = program.getTypeChecker();
  const exports = moduleExports(program, packageRoot, "src/di/index.ts");

  test("DI helpers are documented", () => {
    expectDocumented(checker, exports, [
      "DI",
      "Dependency",
      "inject",
      "provide",
      "scoped",
      "singleton",
    ]);
  });
});
