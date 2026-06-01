import { describe, test, expect, assert } from "vitest";
import {
  createPackageProgram,
  expectDocumented,
  getPackageRoot,
  moduleExports,
  symbolHasDocs,
} from "./support.js";

describe("@prodkit/op/policy JSDoc coverage", () => {
  const packageRoot = getPackageRoot();
  const program = createPackageProgram(packageRoot);
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
    expectDocumented(checker, exports, ["RetryPolicy", "Delay", "ExponentialDelayOptions"]);
  });

  test("Policy type alias and namespace helpers are documented", () => {
    expectDocumented(checker, exports, ["Policy"]);

    const policySymbol = exports.find((symbol) => symbol.name === "Policy");
    assert(policySymbol, "Expected Policy export");
    const namespaceExports = checker.getExportsOfModule(policySymbol);
    expectDocumented(checker, namespaceExports, ["Input", "Source", "Type", "BuiltIn"]);
  });
});

describe("@prodkit/op/hkt JSDoc coverage", () => {
  const packageRoot = getPackageRoot();
  const program = createPackageProgram(packageRoot);
  const checker = program.getTypeChecker();
  const exports = moduleExports(program, packageRoot, "src/hkt.ts");

  test("HKT symbols and types are documented", () => {
    expectDocumented(checker, exports, ["HKT"]);
  });
});

describe("@prodkit/op/di JSDoc coverage", () => {
  const packageRoot = getPackageRoot();
  const program = createPackageProgram(packageRoot);
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

  test("DI binding errors are documented", () => {
    const diSymbol = exports.find((symbol) => symbol.name === "DI");
    assert(diSymbol, "Expected DI export");
    const diDeclaration = diSymbol.valueDeclaration ?? diSymbol.declarations?.[0];
    assert(diDeclaration, "Expected DI declaration");
    const diType = checker.getTypeOfSymbolAtLocation(diSymbol, diDeclaration);
    expectDocumented(checker, diType.getProperties(), [
      "MissingDependencyError",
      "DuplicateDependencyError",
    ]);
  });
});
