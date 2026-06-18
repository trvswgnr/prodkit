import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { isRecordLike } from "@prodkit/shared/runtime";
import * as ts from "typescript";

const prodkitOpPackageName = "@prodkit/op";
const tsConfigFileName = "tsconfig.json";

export type TypeAwareRuleContext = {
  cwd?: string;
  filename?: string;
  physicalFilename?: string;
  sourceCode?: unknown;
};

export type RangedNode = {
  range: readonly [number, number];
};

export type OpTypeDetector = {
  isAnyOrUnknownExpression(node: RangedNode): boolean;
  isOpFactoryExpression(node: RangedNode): boolean;
  isOpExpression(node: RangedNode): boolean;
};

type TypeScriptProject = {
  checker: ts.TypeChecker;
  program: ts.Program;
  sourceFileIndexes: WeakMap<ts.SourceFile, SourceFileIndex>;
};

type SourceFileIndex = {
  byRange: Map<string, ts.Node[]>;
};

type SourceOverride = {
  fileName: string;
  text: string;
};

type TypeClassificationCache = {
  opFactoryTypes: Map<ts.Type, boolean>;
  opTypes: Map<ts.Type, boolean>;
};

const projectCache = new Map<string, TypeScriptProject>();
const projectReuseCache = new Map<string, TypeScriptProject>();
const packageNameCache = new Map<string, string | undefined>();
const canonicalPathCache = new Map<string, string>();
const maxProjectCacheEntries = 32;

export function clearOpTypeDetectorCaches(): void {
  projectCache.clear();
  projectReuseCache.clear();
  packageNameCache.clear();
  canonicalPathCache.clear();
}

export function createOpTypeDetector(context: TypeAwareRuleContext): OpTypeDetector | undefined {
  const fileName = resolveLintFileName(context);
  if (fileName === undefined) return undefined;

  const project = getTypeScriptProject(fileName, sourceTextFromContext(context));
  if (project === undefined) return undefined;

  const sourceFile = getProjectSourceFile(project.program, fileName);
  if (sourceFile === undefined) return undefined;

  const nodeAtRangeCache = new Map<string, ts.Node | undefined>();
  const anyOrUnknownExpressionCache = new Map<string, boolean>();
  const opFactoryExpressionCache = new Map<string, boolean>();
  const opExpressionCache = new Map<string, boolean>();
  const typeClassificationCache: TypeClassificationCache = {
    opFactoryTypes: new Map(),
    opTypes: new Map(),
  };

  const nodeAtRange = (range: readonly [number, number]): ts.Node | undefined => {
    const key = rangeKey(range[0], range[1]);
    if (nodeAtRangeCache.has(key)) return nodeAtRangeCache.get(key);

    const tsNode = findTypeScriptNodeAtRange(project, sourceFile, range);
    nodeAtRangeCache.set(key, tsNode);
    return tsNode;
  };

  return {
    isAnyOrUnknownExpression(node) {
      const key = rangeKey(node.range[0], node.range[1]);
      const cached = anyOrUnknownExpressionCache.get(key);
      if (cached !== undefined) return cached;

      const tsNode = nodeAtRange(node.range);
      if (tsNode === undefined) return false;

      const result = isAnyOrUnknown(project.checker.getTypeAtLocation(tsNode));
      anyOrUnknownExpressionCache.set(key, result);
      return result;
    },
    isOpFactoryExpression(node) {
      const key = rangeKey(node.range[0], node.range[1]);
      const cached = opFactoryExpressionCache.get(key);
      if (cached !== undefined) return cached;

      const tsNode = nodeAtRange(node.range);
      if (tsNode === undefined) return false;

      const result = expressionIsProdkitOpFactory(project.checker, tsNode, typeClassificationCache);
      opFactoryExpressionCache.set(key, result);
      return result;
    },
    isOpExpression(node) {
      const key = rangeKey(node.range[0], node.range[1]);
      const cached = opExpressionCache.get(key);
      if (cached !== undefined) return cached;

      const tsNode = nodeAtRange(node.range);
      if (tsNode === undefined) return false;

      const result = expressionProducesProdkitOp(project.checker, tsNode, typeClassificationCache);
      opExpressionCache.set(key, result);
      return result;
    },
  };
}

function sourceTextFromContext(context: TypeAwareRuleContext): string | undefined {
  const sourceCode = context.sourceCode;
  if (!isRecordLike(sourceCode)) return undefined;

  const text = sourceCode["text"];
  return typeof text === "string" ? text : undefined;
}

function resolveLintFileName(context: TypeAwareRuleContext): string | undefined {
  const rawFileName = context.physicalFilename ?? context.filename;
  if (rawFileName === undefined || rawFileName.startsWith("<")) return undefined;

  const cwd = context.cwd ?? process.cwd();
  return isAbsolute(rawFileName) ? normalize(rawFileName) : normalize(resolve(cwd, rawFileName));
}

function getTypeScriptProject(
  fileName: string,
  sourceText: string | undefined,
): TypeScriptProject | undefined {
  const configPath = ts.findConfigFile(dirname(fileName), ts.sys.fileExists, tsConfigFileName);
  const sourceOverride = createSourceOverride(fileName, sourceText);

  if (configPath === undefined) {
    return getInferredProject(fileName, sourceOverride);
  }

  const parsedConfig = parseConfig(configPath);
  if (parsedConfig === undefined) {
    return getInferredProject(fileName, sourceOverride);
  }

  const canonicalFileName = canonicalPath(fileName);
  const parsedFileNames = new Set(parsedConfig.fileNames.map(canonicalPath));
  const fileIsInConfig = parsedFileNames.has(canonicalFileName);
  const rootNames = fileIsInConfig ? parsedConfig.fileNames : [...parsedConfig.fileNames, fileName];
  const options = normalizeCompilerOptions(parsedConfig.options);
  const cacheKey = [
    "config",
    canonicalPath(configPath),
    fileIsInConfig ? "included" : canonicalFileName,
    sourceOverride === undefined ? "disk" : sourceOverrideCacheKey(sourceOverride),
  ].join(":");
  const reuseKey =
    fileIsInConfig || sourceOverride !== undefined
      ? undefined
      : ["config-reuse", canonicalPath(configPath), "excluded", "disk"].join(":");

  return getCachedProject(cacheKey, rootNames, options, sourceOverride, reuseKey);
}

function getInferredProject(
  fileName: string,
  sourceOverride: SourceOverride | undefined,
): TypeScriptProject {
  const options = normalizeCompilerOptions({
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });
  const cacheKey = [
    "inferred",
    canonicalPath(fileName),
    sourceOverride === undefined ? "disk" : sourceOverrideCacheKey(sourceOverride),
  ].join(":");

  return getCachedProject(cacheKey, [fileName], options, sourceOverride);
}

function createSourceOverride(
  fileName: string,
  sourceText: string | undefined,
): SourceOverride | undefined {
  if (sourceText === undefined) return undefined;
  if (sourceMatchesDisk(fileName, sourceText)) return undefined;

  return { fileName, text: sourceText };
}

function sourceMatchesDisk(fileName: string, sourceText: string): boolean {
  try {
    return readFileSync(fileName, "utf8") === sourceText;
  } catch {
    return false;
  }
}

function sourceOverrideCacheKey(sourceOverride: SourceOverride): string {
  const sourceHash = createHash("sha256").update(sourceOverride.text).digest("hex");
  return `${canonicalPath(sourceOverride.fileName)}:${sourceOverride.text.length}:${sourceHash}`;
}

function parseConfig(configPath: string): ts.ParsedCommandLine | undefined {
  return ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic() {},
    },
  );
}

function normalizeCompilerOptions(options: ts.CompilerOptions): ts.CompilerOptions {
  return {
    ...options,
    allowJs: true,
    noEmit: true,
  };
}

function getCachedProject(
  cacheKey: string,
  rootNames: readonly string[],
  options: ts.CompilerOptions,
  sourceOverride: SourceOverride | undefined,
  reuseKey?: string,
): TypeScriptProject {
  const cached = projectCache.get(cacheKey);
  if (cached !== undefined) {
    projectCache.delete(cacheKey);
    projectCache.set(cacheKey, cached);
    return cached;
  }

  const host = createCompilerHost(options, sourceOverride);
  const oldProgram = reuseKey === undefined ? undefined : projectReuseCache.get(reuseKey)?.program;
  const program = ts.createProgram([...rootNames], options, host, oldProgram);
  const project: TypeScriptProject = {
    checker: program.getTypeChecker(),
    program,
    sourceFileIndexes: new WeakMap(),
  };

  cacheProject(cacheKey, project);
  if (reuseKey !== undefined) projectReuseCache.set(reuseKey, project);
  return project;
}

function cacheProject(cacheKey: string, project: TypeScriptProject): void {
  if (projectCache.size >= maxProjectCacheEntries) {
    const oldestKey = projectCache.keys().next().value;
    if (oldestKey !== undefined) projectCache.delete(oldestKey);
  }

  projectCache.set(cacheKey, project);
}

function createCompilerHost(
  options: ts.CompilerOptions,
  sourceOverride: SourceOverride | undefined,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  if (sourceOverride === undefined) return host;

  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const sourceFileName = canonicalPath(sourceOverride.fileName);

  host.fileExists = (fileName) => {
    if (canonicalPath(fileName) === sourceFileName) return true;
    return originalFileExists(fileName);
  };
  host.readFile = (fileName) => {
    if (canonicalPath(fileName) === sourceFileName) return sourceOverride.text;
    return originalReadFile(fileName);
  };

  return host;
}

function getProjectSourceFile(program: ts.Program, fileName: string): ts.SourceFile | undefined {
  const direct = program.getSourceFile(fileName);
  if (direct !== undefined) return direct;

  const canonicalFileName = canonicalPath(fileName);
  return program
    .getSourceFiles()
    .find((sourceFile) => canonicalPath(sourceFile.fileName) === canonicalFileName);
}

function findTypeScriptNodeAtRange(
  project: TypeScriptProject,
  sourceFile: ts.SourceFile,
  range: readonly [number, number],
): ts.Node | undefined {
  const index = getSourceFileIndex(project, sourceFile);
  const exactMatches = index.byRange.get(rangeKey(range[0], range[1]));
  const exactExpression = findLastNode(exactMatches, ts.isExpression);
  if (exactExpression !== undefined) return exactExpression;
  if (exactMatches !== undefined && exactMatches.length > 0)
    return exactMatches[exactMatches.length - 1];

  return findBestMatchingExpression(sourceFile, range[0], range[1]);
}

function expressionProducesProdkitOp(
  checker: ts.TypeChecker,
  node: ts.Node,
  cache: TypeClassificationCache,
): boolean {
  const type = checker.getTypeAtLocation(node);
  if (isProdkitOpType(checker, type, cache)) return true;

  if (ts.isCallExpression(node)) {
    const signature = checker.getResolvedSignature(node);
    if (signature !== undefined) {
      return isProdkitOpType(checker, checker.getReturnTypeOfSignature(signature), cache);
    }
  }

  return false;
}

function expressionIsProdkitOpFactory(
  checker: ts.TypeChecker,
  node: ts.Node,
  cache: TypeClassificationCache,
): boolean {
  return isProdkitOpFactoryType(checker, checker.getTypeAtLocation(node), cache);
}

function findBestMatchingExpression(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): ts.Expression | undefined {
  let match: ts.Expression | undefined;
  let bestScore: readonly [number, number] = [-1, Number.NEGATIVE_INFINITY];

  const visit = (node: ts.Node) => {
    if (!ts.isExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    const score = expressionMatchScore(sourceFile, node, start, end);
    if (compareMatchScores(score, bestScore) > 0) {
      bestScore = score;
      match = node;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return match;
}

function expressionMatchScore(
  sourceFile: ts.SourceFile,
  node: ts.Expression,
  start: number,
  end: number,
): readonly [number, number] {
  const nodeStart = node.getStart(sourceFile);
  const nodeEnd = node.getEnd();
  const overlapStart = Math.max(start, nodeStart);
  const overlapEnd = Math.min(end, nodeEnd);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  const span = nodeEnd - nodeStart;

  return [overlap, -span];
}

function compareMatchScores(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1;
  }

  return 0;
}

function findLastNode<T extends ts.Node>(
  nodes: readonly ts.Node[] | undefined,
  predicate: (node: ts.Node) => node is T,
): T | undefined {
  if (nodes === undefined) return undefined;

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined && predicate(node)) return node;
  }

  return undefined;
}

function getSourceFileIndex(
  project: TypeScriptProject,
  sourceFile: ts.SourceFile,
): SourceFileIndex {
  const cached = project.sourceFileIndexes.get(sourceFile);
  if (cached !== undefined) return cached;

  const index = buildSourceFileIndex(sourceFile);
  project.sourceFileIndexes.set(sourceFile, index);
  return index;
}

function buildSourceFileIndex(sourceFile: ts.SourceFile): SourceFileIndex {
  const byRange = new Map<string, ts.Node[]>();

  const visit = (node: ts.Node) => {
    const key = rangeKey(node.getStart(sourceFile), node.getEnd());
    const nodes = byRange.get(key);
    if (nodes === undefined) {
      byRange.set(key, [node]);
    } else {
      nodes.push(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { byRange };
}

function rangeKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function isProdkitOpType(
  checker: ts.TypeChecker,
  type: ts.Type,
  cache: TypeClassificationCache,
  seen: Set<ts.Type> = new Set(),
): boolean {
  const cached = cache.opTypes.get(type);
  if (cached !== undefined) return cached;
  if (seen.has(type)) return false;
  seen.add(type);

  const result = (() => {
    if (isAnyOrUnknown(type)) return false;
    if (isProdkitOpAlias(type) || hasProdkitOpPackageShape(checker, type)) return true;

    if (type.isUnion()) {
      return type.types.some((part) => isProdkitOpType(checker, part, cache, seen));
    }

    if (type.isIntersection()) {
      return type.types.some((part) => isProdkitOpType(checker, part, cache, seen));
    }

    const apparent = checker.getApparentType(type);
    if (apparent !== type && isProdkitOpType(checker, apparent, cache, seen)) return true;

    const constraint = checker.getBaseConstraintOfType(type);
    if (constraint !== undefined && constraint !== type) {
      return isProdkitOpType(checker, constraint, cache, seen);
    }

    return false;
  })();

  seen.delete(type);
  cache.opTypes.set(type, result);
  return result;
}

function isProdkitOpFactoryType(
  checker: ts.TypeChecker,
  type: ts.Type,
  cache: TypeClassificationCache,
  seen: Set<ts.Type> = new Set(),
): boolean {
  const cached = cache.opFactoryTypes.get(type);
  if (cached !== undefined) return cached;
  if (seen.has(type)) return false;
  seen.add(type);

  const result = (() => {
    if (isAnyOrUnknown(type)) return false;
    if (hasProdkitOpFactoryPackageShape(checker, type)) return true;

    if (type.isUnion()) {
      return type.types.some((part) => isProdkitOpFactoryType(checker, part, cache, seen));
    }

    if (type.isIntersection()) {
      return type.types.some((part) => isProdkitOpFactoryType(checker, part, cache, seen));
    }

    const apparent = checker.getApparentType(type);
    if (apparent !== type && isProdkitOpFactoryType(checker, apparent, cache, seen)) return true;

    const constraint = checker.getBaseConstraintOfType(type);
    if (constraint !== undefined && constraint !== type) {
      return isProdkitOpFactoryType(checker, constraint, cache, seen);
    }

    return false;
  })();

  seen.delete(type);
  cache.opFactoryTypes.set(type, result);
  return result;
}

function isAnyOrUnknown(type: ts.Type): boolean {
  const flags = type.getFlags();
  return (flags & ts.TypeFlags.Any) !== 0 || (flags & ts.TypeFlags.Unknown) !== 0;
}

function isProdkitOpAlias(type: ts.Type): boolean {
  const aliasSymbol = type.aliasSymbol;
  if (aliasSymbol === undefined) return false;

  return symbolHasDeclarationFromPackage(aliasSymbol, prodkitOpPackageName, "Op");
}

function hasProdkitOpPackageShape(checker: ts.TypeChecker, type: ts.Type): boolean {
  const tagProperty = type.getProperty("_tag");
  const runProperty = type.getProperty("run");
  if (tagProperty === undefined || runProperty === undefined) return false;

  const declaration = firstDeclaration(tagProperty) ?? firstDeclaration(runProperty);
  if (declaration === undefined) return false;

  const tagType = checker.getTypeOfSymbolAtLocation(tagProperty, declaration);

  return (
    typeIncludesStringLiteral(tagType, "Op") &&
    symbolHasDeclarationFromPackage(tagProperty, prodkitOpPackageName) &&
    symbolHasDeclarationFromPackage(runProperty, prodkitOpPackageName)
  );
}

function hasProdkitOpFactoryPackageShape(checker: ts.TypeChecker, type: ts.Type): boolean {
  const tagProperty = type.getProperty("_tag");
  if (tagProperty === undefined) return false;

  const declaration = firstDeclaration(tagProperty);
  if (declaration === undefined) return false;

  const tagType = checker.getTypeOfSymbolAtLocation(tagProperty, declaration);

  return (
    typeIncludesStringLiteral(tagType, "OpFactory") &&
    symbolHasDeclarationFromPackage(tagProperty, prodkitOpPackageName)
  );
}

function typeIncludesStringLiteral(type: ts.Type, expected: string): boolean {
  if (type.isStringLiteral()) return type.value === expected;
  if (type.isUnion()) return type.types.some((part) => typeIncludesStringLiteral(part, expected));

  return false;
}

function firstDeclaration(symbol: ts.Symbol): ts.Declaration | undefined {
  return symbol.declarations?.[0];
}

function symbolHasDeclarationFromPackage(
  symbol: ts.Symbol,
  packageName: string,
  declarationName?: string,
): boolean {
  return (
    symbol.declarations?.some((declaration) => {
      if (declarationName !== undefined && declarationIdentifier(declaration) !== declarationName) {
        return false;
      }

      return packageNameForFile(declaration.getSourceFile().fileName) === packageName;
    }) ?? false
  );
}

function declarationIdentifier(declaration: ts.Declaration): string | undefined {
  const name = ts.getNameOfDeclaration(declaration);
  return name !== undefined && ts.isIdentifier(name) ? name.text : undefined;
}

function packageNameForFile(fileName: string): string | undefined {
  let dir = dirname(canonicalPath(fileName));
  const visited: string[] = [];

  while (true) {
    const cached = packageNameCache.get(dir);
    if (packageNameCache.has(dir)) {
      cachePackageNameForDirs(visited, cached);
      return cached;
    }

    visited.push(dir);
    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageName = readPackageName(packageJsonPath);
      cachePackageNameForDirs(visited, packageName);
      return packageName;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      cachePackageNameForDirs(visited, undefined);
      return undefined;
    }

    dir = parent;
  }
}

function cachePackageNameForDirs(dirs: readonly string[], packageName: string | undefined): void {
  for (const dir of dirs) packageNameCache.set(dir, packageName);
}

function readPackageName(packageJsonPath: string): string | undefined {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return isRecordLike(packageJson) && typeof packageJson["name"] === "string"
      ? packageJson["name"]
      : undefined;
  } catch {
    return undefined;
  }
}

function canonicalPath(fileName: string): string {
  const normalized = normalize(fileName);
  const cached = canonicalPathCache.get(normalized);
  if (cached !== undefined) return cached;

  const canonical = safeRealpath(normalized);
  canonicalPathCache.set(normalized, canonical);
  return canonical;
}

function safeRealpath(fileName: string): string {
  try {
    return normalize(realpathSync.native(fileName));
  } catch {
    return normalize(resolve(fileName));
  }
}
