import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createLogger, readRepoRoot } from "./utils.ts";

const logger = createLogger();

const MONITORED = [
  {
    entrypoint: "packages/op/src/index.ts",
    changelog: "packages/op/CHANGELOG.md",
    label: "@prodkit/op public exports",
  },
  {
    entrypoint: "packages/op/src/di/index.ts",
    changelog: "packages/op/CHANGELOG.md",
    label: "@prodkit/op/di public exports",
  },
] as const;

type ExportEntry = {
  kind: "value" | "type" | "namespace";
  name: string;
  from?: string;
};

function parseExportSpecifier(spec: string): { kind: "value" | "type"; name: string } {
  const trimmed = spec.trim();
  const typeMatch = trimmed.match(/^type\s+(.+)$/);
  if (typeMatch) {
    return { kind: "type", name: typeMatch[1] ?? "" };
  }
  return { kind: "value", name: trimmed };
}

function parseExportBlockNames(block: string): Array<{ kind: "value" | "type"; name: string }> {
  const names: Array<{ kind: "value" | "type"; name: string }> = [];
  const parts = block.split(",");
  for (const part of parts) {
    const parsed = parseExportSpecifier(part);
    if (parsed.name) names.push(parsed);
  }
  return names;
}

function readBalancedBlock(source: string, openBraceIndex: number): string {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, index);
      }
    }
  }
  throw new Error(`unbalanced export block near index ${openBraceIndex}`);
}

function collectExportEntries(source: string): ExportEntry[] {
  const entries: ExportEntry[] = [];
  const exportPattern = /^export\s+/gm;

  for (const match of source.matchAll(exportPattern)) {
    const start = match.index ?? 0;
    const statement = source.slice(start);
    const trimmed = statement.trimStart();

    const namespaceMatch = trimmed.match(/^export\s+\*\s+as\s+(\w+)/);
    if (namespaceMatch) {
      entries.push({ kind: "namespace", name: namespaceMatch[1] ?? "" });
      continue;
    }

    const blockHeader = trimmed.match(/^export\s+(type\s+)?\{/);
    if (blockHeader) {
      const openBraceIndex = start + trimmed.indexOf("{");
      const blockBody = readBalancedBlock(source, openBraceIndex);
      const afterClose = source.slice(openBraceIndex);
      const closeIndex = afterClose.indexOf("}");
      const trailer = afterClose.slice(closeIndex + 1).trim();
      const fromMatch = trailer.match(/^from\s+["']([^"']+)["']/);
      const from = fromMatch?.[1];
      const defaultKind = blockHeader[1] ? ("type" as const) : undefined;

      for (const specifier of parseExportBlockNames(blockBody)) {
        entries.push({
          kind: defaultKind ?? specifier.kind,
          name: specifier.name,
          from,
        });
      }
      continue;
    }

    const interfaceMatch = trimmed.match(/^export\s+interface\s+(\w+)/);
    if (interfaceMatch) {
      entries.push({ kind: "type", name: interfaceMatch[1] ?? "" });
      continue;
    }

    const typeAliasMatch = trimmed.match(/^export\s+type\s+(\w+)/);
    if (typeAliasMatch) {
      entries.push({ kind: "type", name: typeAliasMatch[1] ?? "" });
      continue;
    }

    const constMatch = trimmed.match(/^export\s+const\s+(\w+)/);
    if (constMatch) {
      entries.push({ kind: "value", name: constMatch[1] ?? "" });
    }
  }

  return entries;
}

function exportFingerprint(source: string): string {
  const entries = collectExportEntries(source)
    .map((entry) => `${entry.kind}:${entry.name}`)
    .sort();
  return entries.join("\n");
}

function readGitFile(ref: string, relativePath: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${relativePath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function resolveBaseRef(): string {
  const explicit = process.env.CHANGELOG_API_BASE_REF?.trim();
  if (explicit) return explicit;

  const eventBase = process.env.GITHUB_BASE_SHA?.trim();
  if (eventBase) return eventBase;

  try {
    return execFileSync("git", ["merge-base", "HEAD", "origin/main"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    try {
      return execFileSync("git", ["rev-parse", "origin/main"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "HEAD";
    }
  }
}

function pathChangedSinceBase(repoRoot: string, baseRef: string, relativePath: string): boolean {
  try {
    // Compare merge-base to the working tree so local uncommitted changelog edits count.
    execFileSync("git", ["diff", "--quiet", baseRef, "--", relativePath], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return false;
  } catch {
    return true;
  }
}

function main(): number {
  const repoRoot = readRepoRoot();
  const baseRef = resolveBaseRef();
  const failures: string[] = [];

  for (const target of MONITORED) {
    const currentPath = path.join(repoRoot, target.entrypoint);
    let currentSource: string;
    try {
      currentSource = readFileSync(currentPath, "utf8");
    } catch {
      failures.push(`${target.label}: missing entrypoint at ${target.entrypoint}`);
      continue;
    }

    const baseSource = readGitFile(baseRef, target.entrypoint);
    if (baseSource === null) {
      continue;
    }

    const currentFingerprint = exportFingerprint(currentSource);
    const baseFingerprint = exportFingerprint(baseSource);
    if (currentFingerprint === baseFingerprint) {
      continue;
    }

    if (!pathChangedSinceBase(repoRoot, baseRef, target.changelog)) {
      failures.push(
        `${target.label} changed since ${baseRef} but ${target.changelog} was not updated. Add a note under ## [Unreleased].`,
      );
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      logger.error(failure);
    }
    return 1;
  }

  logger.info(`changelog API export check passed (base ${baseRef})`);
  return 0;
}

process.exit(main());
