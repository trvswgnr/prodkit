import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createLogger, readRepoRoot } from "../lib/utils.ts";

const logger = createLogger();

const OP_INVARIANTS_MD = "docs/contributor/op-invariants.md";

/** Repo-relative paths in op-invariants.md backticks (concrete files only). */
const PATH_IN_BACKTICKS = /`(packages\/op\/(?:src|tests)\/[^`*]+)`/g;

/** Source path plus symbol, e.g. `runtime.ts` (`settleIteratorWithCleanup`). */
const SOURCE_SYMBOL = /`(packages\/op\/src\/[^`]+\.ts)`\s+\(`([^`]+)`\)/g;

/** Test file plus Vitest title, e.g. `foo.test.ts` (`my test`). */
const TEST_TITLE = /`(packages\/op\/tests\/[^`]+\.test\.ts)`\s+\(`([^`]+)`\)/g;

function assertFileExists(repoRoot: string, relativePath: string): void {
  const absolute = path.join(repoRoot, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(`${OP_INVARIANTS_MD}: missing path \`${relativePath}\``);
  }
}

function assertSymbolInSource(repoRoot: string, relativePath: string, symbol: string): void {
  const source = readFileSync(path.join(repoRoot, relativePath), "utf8");
  const pattern = new RegExp(`\\b(?:async\\s+)?function\\s+${symbol}\\b|\\bconst\\s+${symbol}\\b`);
  if (!pattern.test(source)) {
    throw new Error(
      `${OP_INVARIANTS_MD}: \`${relativePath}\` does not define \`${symbol}\` (update doc or implementation)`,
    );
  }
}

function assertTestTitle(repoRoot: string, relativePath: string, title: string): void {
  const source = readFileSync(path.join(repoRoot, relativePath), "utf8");
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\btest\\(\\s*["'\`]${escaped}["'\`]`);
  if (!pattern.test(source)) {
    throw new Error(
      `${OP_INVARIANTS_MD}: \`${relativePath}\` has no test titled \`${title}\` (update doc or rename test)`,
    );
  }
}

function collectConcretePaths(content: string): Set<string> {
  const paths = new Set<string>();
  for (const match of content.matchAll(PATH_IN_BACKTICKS)) {
    const candidate = match[1];
    if (candidate === undefined || candidate.includes("*")) continue;
    paths.add(candidate);
  }
  return paths;
}

function main(): void {
  const repoRoot = readRepoRoot();
  const invariantsPath = path.join(repoRoot, OP_INVARIANTS_MD);
  const content = readFileSync(invariantsPath, "utf8");

  for (const relativePath of collectConcretePaths(content)) {
    assertFileExists(repoRoot, relativePath);
  }

  for (const match of content.matchAll(SOURCE_SYMBOL)) {
    const relativePath = match[1];
    const symbol = match[2];
    if (relativePath === undefined || symbol === undefined) continue;
    assertFileExists(repoRoot, relativePath);
    assertSymbolInSource(repoRoot, relativePath, symbol);
  }

  for (const match of content.matchAll(TEST_TITLE)) {
    const relativePath = match[1];
    const title = match[2];
    if (relativePath === undefined || title === undefined) continue;
    assertFileExists(repoRoot, relativePath);
    assertTestTitle(repoRoot, relativePath, title);
  }

  logger.info(`${OP_INVARIANTS_MD} references are consistent with the repo`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message);
  process.exit(1);
}
