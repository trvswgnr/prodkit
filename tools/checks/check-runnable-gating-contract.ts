import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createLogger, readRepoRoot } from "../lib/utils.ts";

const logger = createLogger();

export const OP_VITEST_CONFIG = "packages/op/vitest.config.ts";
export const OP_TESTS_DIR = "packages/op/tests";

/** Coverage excludes for compile-time gating modules (paths must match vitest.config). */
export const REQUIRED_COVERAGE_EXCLUDES = ["src/core/meta.ts", "src/core/plan/surface.ts"] as const;

/**
 * Stable Vitest describe/test titles for runnable gating. Files may move; titles should not
 * change without updating this checker and the runtime-architecture doc.
 */
export const CONTRACT_MARKERS = [
  {
    label: "metadata merge and runnable type contracts",
    pattern: /\bdescribe\(\s*["']metadata type contracts["']/,
  },
  {
    label: "Blocking and withBlocking type contracts",
    pattern: /\bdescribe\(\s*["']Blocking type contracts["']/,
  },
  {
    label: "DI metadata and blocking on Op.run",
    pattern: /\bdescribe\(\s*["']DI type inference["']/,
  },
  {
    label: "Blocking with never payload does not block run",
    pattern: /\btest\(\s*["']Blocking with never payload does not block run["']/,
  },
  {
    label: "DI missing dependency at runtime",
    pattern:
      /\btest\(\s*["']missing dependency returns UnhandledException with MissingDependencyError cause["']/,
  },
] as const;

export function readOpTestsTree(repoRoot: string): string {
  return readTestsRecursive(path.join(repoRoot, OP_TESTS_DIR));
}

function readTestsRecursive(dir: string): string {
  let combined = "";
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      combined += readTestsRecursive(absolute);
      continue;
    }
    if (!entry.endsWith(".test.ts")) continue;
    combined += readFileSync(absolute, "utf8");
    combined += "\n";
  }
  return combined;
}

export function assertCoverageExcludes(repoRoot: string): void {
  const config = readFileSync(path.join(repoRoot, OP_VITEST_CONFIG), "utf8");
  for (const exclude of REQUIRED_COVERAGE_EXCLUDES) {
    if (!config.includes(`"${exclude}"`)) {
      throw new Error(
        `${OP_VITEST_CONFIG}: coverage.exclude must list "${exclude}" (compile-time gating modules)`,
      );
    }
  }
}

export function assertContractMarkers(testSources: string): void {
  for (const { label, pattern } of CONTRACT_MARKERS) {
    if (!pattern.test(testSources)) {
      throw new Error(
        `runnable gating contract missing: ${label} (add or restore a Vitest suite/test with this title under ${OP_TESTS_DIR})`,
      );
    }
  }
}

export function checkRunnableGatingContract(repoRoot: string): void {
  assertCoverageExcludes(repoRoot);
  assertContractMarkers(readOpTestsTree(repoRoot));
}

function main(): void {
  checkRunnableGatingContract(readRepoRoot());
  logger.info("runnable gating contract check passed");
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    main();
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
