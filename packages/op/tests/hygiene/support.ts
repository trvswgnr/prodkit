import { assert, expect } from "vitest";
import ts from "typescript";

export type HygieneViolation = {
  file: string;
  line: number;
  column: number;
  message: string;
};

export function getPackageRoot(): string {
  return ts.sys.getCurrentDirectory();
}

export function createPackageProgram(packageRoot = getPackageRoot()): ts.Program {
  const tsconfigPath = `${packageRoot}/tsconfig.json`;
  const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, packageRoot);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

export function getSourceFile(
  program: ts.Program,
  packageRoot: string,
  relativePath: string,
): ts.SourceFile {
  const sourceFile = program.getSourceFile(`${packageRoot}/${relativePath}`);
  assert(sourceFile, `Expected ${relativePath} in TypeScript program`);
  return sourceFile;
}

export function getPackageSourceFiles(program: ts.Program, packageRoot: string): ts.SourceFile[] {
  return program
    .getSourceFiles()
    .filter(
      (sourceFile) =>
        sourceFile.fileName.startsWith(`${packageRoot}/src/`) &&
        !sourceFile.fileName.endsWith(".d.ts") &&
        !sourceFile.fileName.endsWith(".test.ts"),
    );
}

export function moduleExports(
  program: ts.Program,
  packageRoot: string,
  entryPath: string,
): ts.Symbol[] {
  const checker = program.getTypeChecker();
  const source = getSourceFile(program, packageRoot, entryPath);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  assert(moduleSymbol, `Expected module symbol for ${entryPath}`);
  return checker.getExportsOfModule(moduleSymbol);
}

export function resolveSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

export function symbolSatisfies(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
  predicate: (resolved: ts.Symbol) => boolean,
): boolean {
  if (!symbol) return false;

  const visited = new Set<ts.Symbol>();

  const inspect = (current: ts.Symbol | undefined): boolean => {
    if (!current) return false;
    if (visited.has(current)) return false;
    visited.add(current);

    const resolved = resolveSymbol(checker, current);
    if (predicate(resolved)) {
      return true;
    }

    for (const declaration of resolved.declarations ?? []) {
      if (ts.isPropertyAssignment(declaration)) {
        const initializerSymbol = checker.getSymbolAtLocation(declaration.initializer);
        if (inspect(initializerSymbol)) return true;
        continue;
      }

      if (ts.isShorthandPropertyAssignment(declaration)) {
        const shorthandSymbol = checker.getShorthandAssignmentValueSymbol(declaration);
        if (inspect(shorthandSymbol)) return true;
      }
    }

    return false;
  };

  return inspect(symbol);
}

export function symbolHasDocs(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): boolean {
  return symbolSatisfies(
    checker,
    symbol,
    (resolved) =>
      resolved.getDocumentationComment(checker).length > 0 ||
      resolved.getJsDocTags(checker).length > 0,
  );
}

export function symbolHasExample(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): boolean {
  return symbolSatisfies(checker, symbol, (resolved) =>
    resolved.getJsDocTags(checker).some((tag) => tag.name.toLowerCase() === "example"),
  );
}

export function expectDocumented(
  checker: ts.TypeChecker,
  symbols: readonly ts.Symbol[],
  names: readonly string[],
): void {
  const documented = names.filter((name) => {
    const symbol = symbols.find((candidate) => candidate.name === name);
    return symbolHasDocs(checker, symbol);
  });
  expect(documented).toEqual([...names]);
}

export function nodeLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  packageRoot: string,
): Pick<HygieneViolation, "file" | "line" | "column"> {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: sourceFile.fileName.replace(`${packageRoot}/`, ""),
    line: line + 1,
    column: character + 1,
  };
}

export function formatHygieneViolations(violations: readonly HygieneViolation[]): string {
  return violations
    .map(
      (violation) => `${violation.file}:${violation.line}:${violation.column} ${violation.message}`,
    )
    .join("\n");
}
