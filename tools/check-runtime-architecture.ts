import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createLogger, readRepoRoot } from "./utils.ts";

const logger = createLogger();

const RUNTIME_ARCHITECTURE_MD = "docs/contributor/runtime-architecture.md";

/** `- `packages/op/src/foo.ts` imports `packages/op/src/bar.ts` */
const DOCUMENTED_EDGE =
  /^- `(packages\/op\/src\/[^`]+\.ts)` imports `(packages\/op\/src\/[^`]+\.ts|@prodkit\/shared\/[^`]+)`$/;

type ImportEdge = {
  readonly from: string;
  readonly to: string;
};

function repoRelativeImport(fromFile: string, spec: string): string | undefined {
  if (spec.startsWith("@prodkit/shared/")) return spec;

  if (!spec.startsWith(".")) return undefined;

  const fromDir = path.dirname(fromFile);
  let resolved = path.normalize(path.join(fromDir, spec)).replace(/\\/g, "/");
  if (resolved.endsWith(".js")) resolved = `${resolved.slice(0, -3)}.ts`;
  return resolved;
}

function collectSourceImports(fromFile: string, content: string): Set<string> {
  const imports = new Set<string>();
  const importFrom = /\bfrom\s+["']([^"']+)["']/g;

  for (const match of content.matchAll(importFrom)) {
    const spec = match[1];
    if (spec === undefined) continue;
    const resolved = repoRelativeImport(fromFile, spec);
    if (resolved !== undefined) imports.add(resolved);
  }

  return imports;
}

function collectDocumentedEdges(content: string): ImportEdge[] {
  const edges: ImportEdge[] = [];

  for (const line of content.split("\n")) {
    const match = line.match(DOCUMENTED_EDGE);
    if (match === null) continue;
    const from = match[1];
    const to = match[2];
    if (from === undefined || to === undefined) continue;
    edges.push({ from, to });
  }

  return edges;
}

function groupEdgesBySource(edges: readonly ImportEdge[]): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();

  for (const edge of edges) {
    const targets = grouped.get(edge.from) ?? new Set<string>();
    targets.add(edge.to);
    grouped.set(edge.from, targets);
  }

  return grouped;
}

function assertEdgesMatchSources(repoRoot: string, edges: readonly ImportEdge[]): void {
  const grouped = groupEdgesBySource(edges);

  for (const [from, expectedTargets] of grouped) {
    const absolute = path.join(repoRoot, from);
    const content = readFileSync(absolute, "utf8");
    const actualTargets = collectSourceImports(from, content);

    for (const target of expectedTargets) {
      if (!actualTargets.has(target)) {
        throw new Error(
          `${RUNTIME_ARCHITECTURE_MD}: \`${from}\` is documented as importing \`${target}\`, but the source file does not`,
        );
      }
    }

    const documentedOpImports = [...expectedTargets].filter((target) =>
      target.startsWith("packages/op/src/"),
    );
    const actualOpImports = [...actualTargets].filter((target) =>
      target.startsWith("packages/op/src/"),
    );

    for (const target of actualOpImports) {
      if (!expectedTargets.has(target)) {
        throw new Error(
          `${RUNTIME_ARCHITECTURE_MD}: \`${from}\` imports \`${target}\` but the documented edge list is missing it (add a verified import edge line)`,
        );
      }
    }

    if (documentedOpImports.length !== actualOpImports.length) {
      throw new Error(
        `${RUNTIME_ARCHITECTURE_MD}: \`${from}\` documented op import count (${documentedOpImports.length}) does not match source (${actualOpImports.length})`,
      );
    }
  }
}

function main(): void {
  const repoRoot = readRepoRoot();
  const architecturePath = path.join(repoRoot, RUNTIME_ARCHITECTURE_MD);
  const content = readFileSync(architecturePath, "utf8");
  const edges = collectDocumentedEdges(content);

  if (edges.length === 0) {
    throw new Error(
      `${RUNTIME_ARCHITECTURE_MD}: no verified import edges found (expected lines like \`- \`packages/op/src/foo.ts\` imports \`packages/op/src/bar.ts\`\`)`,
    );
  }

  assertEdgesMatchSources(repoRoot, edges);
  logger.info(`${RUNTIME_ARCHITECTURE_MD} import edges match source files`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message);
  process.exit(1);
}
