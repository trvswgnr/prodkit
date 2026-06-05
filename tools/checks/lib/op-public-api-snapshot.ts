import path from "node:path";
import ts from "typescript";

export const OP_PUBLIC_API_MANIFEST_REL = "packages/op/public-api.manifest.json";
export const MANIFEST_VERSION = 1 as const;

export const PUBLIC_API_ENTRYPOINTS = [
  { id: "@prodkit/op", source: "src/index.ts" },
  { id: "@prodkit/op/di", source: "src/di/index.ts" },
  { id: "@prodkit/op/policy", source: "src/policy/index.ts" },
  { id: "@prodkit/op/hkt", source: "src/hkt.ts" },
] as const;

export type PublicApiExport = {
  name: string;
  kind: "type" | "value";
  signature: string;
};

export type PublicApiEntry = {
  id: string;
  source: string;
  exports: PublicApiExport[];
};

export type PublicApiManifest = {
  version: typeof MANIFEST_VERSION;
  entries: PublicApiEntry[];
};

const TYPE_FORMAT =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.InTypeAlias |
  ts.TypeFormatFlags.UseStructuralFallback;

export function normalizeSignature(signature: string): string {
  return signature.replace(/import\(["'][^"']+["']\)\./g, "");
}

function resolveSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function hasTypeExport(symbol: ts.Symbol): boolean {
  return (
    (symbol.flags & ts.SymbolFlags.Type) !== 0 &&
    (symbol.declarations?.some(
      (declaration) =>
        ts.isTypeAliasDeclaration(declaration) || ts.isInterfaceDeclaration(declaration),
    ) ??
      false)
  );
}

function hasValueExport(symbol: ts.Symbol): boolean {
  return (
    (symbol.flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Function | ts.SymbolFlags.Class)) !== 0
  );
}

function serializeExports(checker: ts.TypeChecker, symbol: ts.Symbol): PublicApiExport[] {
  const resolved = resolveSymbol(checker, symbol);
  const name = resolved.getName();
  if (name === "default" || name.startsWith("__")) {
    return [];
  }

  const declaration = resolved.valueDeclaration ?? resolved.declarations?.[0];
  if (!declaration) {
    return [];
  }

  const exports: PublicApiExport[] = [];

  if (hasTypeExport(resolved)) {
    const typeDeclaration =
      resolved.declarations?.find(
        (item) => ts.isTypeAliasDeclaration(item) || ts.isInterfaceDeclaration(item),
      ) ?? declaration;
    exports.push({
      name,
      kind: "type",
      signature: normalizeSignature(
        checker.typeToString(
          checker.getDeclaredTypeOfSymbol(resolved),
          typeDeclaration,
          TYPE_FORMAT,
        ),
      ),
    });
  }

  if (hasValueExport(resolved)) {
    exports.push({
      name,
      kind: "value",
      signature: normalizeSignature(
        checker.typeToString(
          checker.getTypeOfSymbolAtLocation(resolved, declaration),
          declaration,
          TYPE_FORMAT,
        ),
      ),
    });
  }

  return exports;
}

function createOpProgram(repoRoot: string): { program: ts.Program; packageRoot: string } {
  const packageRoot = path.join(repoRoot, "packages/op");
  const configPath = path.join(packageRoot, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.formatDiagnostic(configFile.error, ts.createCompilerHost({})));
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageRoot);
  return { program: ts.createProgram(parsed.fileNames, parsed.options), packageRoot };
}

export function buildPublicApiManifest(repoRoot: string): PublicApiManifest {
  const { program, packageRoot } = createOpProgram(repoRoot);
  const checker = program.getTypeChecker();
  const entries: PublicApiEntry[] = [];

  for (const entry of PUBLIC_API_ENTRYPOINTS) {
    const sourcePath = path.join(packageRoot, entry.source);
    const sourceFile = program.getSourceFile(sourcePath);
    if (!sourceFile) {
      throw new Error(`Missing source entrypoint: packages/op/${entry.source}`);
    }

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      throw new Error(`Missing module symbol for packages/op/${entry.source}`);
    }

    const exports = checker
      .getExportsOfModule(moduleSymbol)
      .flatMap((symbol) => serializeExports(checker, symbol))
      .sort(
        (left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind),
      );

    entries.push({
      id: entry.id,
      source: entry.source,
      exports,
    });
  }

  return { version: MANIFEST_VERSION, entries };
}

export function renderPublicApiManifest(repoRoot: string): string {
  return `${JSON.stringify(buildPublicApiManifest(repoRoot), null, 2)}\n`;
}
