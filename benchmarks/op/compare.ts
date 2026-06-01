import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";
import {
  BASELINE_IMPLEMENTATION_ID,
  COMPARISON_SCENARIOS,
  computeVsBaseline,
  IMPLEMENTATION_COLUMNS,
  libraryPairOutcome,
  type ComparisonScenarioKey,
  type ImplementationColumn,
  type ImplementationId,
  type LibraryPairOutcome,
  type VsBaselineRatios,
} from "./comparison-matrix.ts";
import {
  formatNumber,
  formatRatio,
  getRepoRoot,
  parseArgValue,
  readEnvironmentReport,
  readPackageVersion,
  resolveOpPackageDir,
  resolveReportPath,
  runTinybenchVariant,
  writeJsonReport,
  type TinybenchRecord,
} from "./harness.ts";

type RuntimeCell = TinybenchRecord;

type LibraryPair = {
  left: ImplementationId;
  right: ImplementationId;
};

type ComparisonReport = {
  generatedAt: string;
  environment: ReturnType<typeof readEnvironmentReport>;
  current: {
    headSha: string;
    dirty: boolean;
    packageVersion: string;
  };
  baselineId: typeof BASELINE_IMPLEMENTATION_ID;
  implementations: Array<(typeof IMPLEMENTATION_COLUMNS)[number]>;
  scenarios: Array<{
    key: ComparisonScenarioKey;
    label: string;
    descriptions: Record<ImplementationId, string>;
    runtime: Record<ImplementationId, RuntimeCell>;
    vsBaseline: VsBaselineRatios;
  }>;
  bundleSize: {
    minBytes: number;
    gzipBytes: number;
  };
  pair?: {
    left: ImplementationId;
    right: ImplementationId;
    scenarios: Array<{
      key: ComparisonScenarioKey;
      faster: ImplementationId;
      margin: number;
    }>;
  };
};

const logger = console;

function runGit(repoRoot: string, args: readonly string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function readCurrentFingerprint(repoRoot: string): { headSha: string; dirty: boolean } {
  const headSha = runGit(repoRoot, ["rev-parse", "HEAD"]).toLowerCase();
  if (!headSha.match(/^[0-9a-f]{40}$/)) {
    throw new Error(`Unable to resolve HEAD SHA: ${headSha}`);
  }
  const dirty = runGit(repoRoot, ["status", "--porcelain"]).length > 0;
  return { headSha, dirty };
}

async function measureBundleSize(
  packageDir: string,
): Promise<{ minBytes: number; gzipBytes: number }> {
  const entryPath = path.join(packageDir, "dist", "index.mjs");
  const source = await readFile(entryPath, "utf8");
  const transformed = await transform(source, {
    loader: "js",
    format: "esm",
    minify: true,
    target: "es2022",
  });
  const minBytes = Buffer.byteLength(transformed.code, "utf8");
  const gzipBytes = gzipSync(Buffer.from(transformed.code, "utf8")).byteLength;
  return { minBytes, gzipBytes };
}

function formatBytes(bytes: number): string {
  return `${Intl.NumberFormat("en-US").format(bytes)} B`;
}

function implementationShortLabel(column: ImplementationColumn): string {
  if (column.id === BASELINE_IMPLEMENTATION_ID) return "Native";
  if (column.id === "op") return "Op";
  if (column.id === "effect") return "Effect";
  return column.header;
}

function formatVsBaseline(ratio: number | undefined): string {
  if (ratio === undefined || ratio === 0) return "n/a";
  if (ratio >= 1) return formatRatio(ratio);
  return `${formatRatio(1 / ratio)} faster`;
}

function isImplementationId(value: string): value is ImplementationId {
  return IMPLEMENTATION_COLUMNS.some((column) => column.id === value);
}

export function parseLibraryPairArg(argv: readonly string[]): LibraryPair | undefined {
  const value = parseArgValue(argv, "--pair=");
  if (value === undefined) return undefined;

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length !== 2) {
    throw new Error(
      `Invalid --pair=${value}. Expected two comma-separated implementation ids (for example --pair=op,effect).`,
    );
  }

  const [left, right] = parts as [string, string];
  if (!isImplementationId(left) || !isImplementationId(right)) {
    const valid = IMPLEMENTATION_COLUMNS.map((column) => column.id).join(", ");
    throw new Error(`Invalid --pair=${value}. Expected ids from: ${valid}.`);
  }
  if (left === BASELINE_IMPLEMENTATION_ID || right === BASELINE_IMPLEMENTATION_ID) {
    throw new Error(
      "--pair compares libraries directly; use the vs-native table for the native baseline.",
    );
  }
  if (left === right) {
    throw new Error("--pair must name two different implementation ids.");
  }

  return { left, right };
}

function findImplementationColumn(
  implementations: ComparisonReport["implementations"],
  id: ImplementationId,
): ImplementationColumn {
  const column = implementations.find((item) => item.id === id);
  if (column === undefined) {
    throw new Error(`Missing implementation column "${id}" in comparison report.`);
  }
  return column;
}

function formatPairOutcome(
  implementations: ComparisonReport["implementations"],
  outcome: LibraryPairOutcome,
): { winner: string; margin: string } {
  return {
    winner: implementationShortLabel(findImplementationColumn(implementations, outcome.faster)),
    margin: formatRatio(outcome.margin),
  };
}

function buildPairReport(
  scenarios: ComparisonReport["scenarios"],
  pair: LibraryPair,
): NonNullable<ComparisonReport["pair"]> {
  return {
    left: pair.left,
    right: pair.right,
    scenarios: scenarios.map((scenario) => {
      const outcome = libraryPairOutcome(
        pair.left,
        scenario.runtime[pair.left].hz,
        pair.right,
        scenario.runtime[pair.right].hz,
      );
      return {
        key: scenario.key,
        faster: outcome.faster,
        margin: outcome.margin,
      };
    }),
  };
}

function printAbsoluteTable(
  scenarios: ComparisonReport["scenarios"],
  implementations: ComparisonReport["implementations"],
): void {
  const scenarioWidth = 32;
  const hzWidth = 14;
  const headers = implementations.map((column) =>
    `${implementationShortLabel(column)} ops/sec`.padStart(hzWidth),
  );
  logger.info("");
  logger.info("Absolute throughput (ops/sec):");
  logger.info("");
  logger.info(`${"Scenario".padEnd(scenarioWidth)} ${headers.join(" ")}`);
  logger.info(
    `${"-".repeat(scenarioWidth)} ${implementations.map(() => "-".repeat(hzWidth)).join(" ")}`,
  );
  for (const scenario of scenarios) {
    const cells = implementations.map((column) =>
      formatNumber(scenario.runtime[column.id].hz).padStart(hzWidth),
    );
    logger.info(`${scenario.label.padEnd(scenarioWidth)} ${cells.join(" ")}`);
  }
}

function printVsBaselineTable(
  scenarios: ComparisonReport["scenarios"],
  implementations: ComparisonReport["implementations"],
): void {
  const scenarioWidth = 32;
  const ratioWidth = 12;
  const competitors = implementations.filter((column) => column.id !== BASELINE_IMPLEMENTATION_ID);
  const headers = competitors.map((column) =>
    `${implementationShortLabel(column)} vs native`.padStart(ratioWidth),
  );
  logger.info("");
  logger.info("Versus native baseline (native ops/sec / library ops/sec; above 1x means slower):");
  logger.info("");
  logger.info(`${"Scenario".padEnd(scenarioWidth)} ${headers.join(" ")}`);
  logger.info(
    `${"-".repeat(scenarioWidth)} ${competitors.map(() => "-".repeat(ratioWidth)).join(" ")}`,
  );
  for (const scenario of scenarios) {
    const cells = competitors.map((column) =>
      formatVsBaseline(scenario.vsBaseline[column.id]).padStart(ratioWidth),
    );
    logger.info(`${scenario.label.padEnd(scenarioWidth)} ${cells.join(" ")}`);
  }
}

function printPairTable(
  scenarios: ComparisonReport["scenarios"],
  implementations: ComparisonReport["implementations"],
  pair: LibraryPair,
): void {
  const leftLabel = implementationShortLabel(findImplementationColumn(implementations, pair.left));
  const rightLabel = implementationShortLabel(
    findImplementationColumn(implementations, pair.right),
  );
  const scenarioWidth = 32;
  const winnerWidth = 10;
  const marginWidth = 12;

  logger.info("");
  logger.info(
    `${leftLabel} vs ${rightLabel} (margin = slower ops/sec / faster ops/sec; values above 1x mean the winner is faster):`,
  );
  logger.info("");
  logger.info(
    `${"Scenario".padEnd(scenarioWidth)} ${"Winner".padStart(winnerWidth)} ${"Margin".padStart(marginWidth)}`,
  );
  logger.info(`${"-".repeat(scenarioWidth)} ${"-".repeat(winnerWidth)} ${"-".repeat(marginWidth)}`);
  for (const scenario of scenarios) {
    const outcome = libraryPairOutcome(
      pair.left,
      scenario.runtime[pair.left].hz,
      pair.right,
      scenario.runtime[pair.right].hz,
    );
    const formatted = formatPairOutcome(implementations, outcome);
    logger.info(
      `${scenario.label.padEnd(scenarioWidth)} ${formatted.winner.padStart(winnerWidth)} ${formatted.margin.padStart(marginWidth)}`,
    );
  }
}

function printBundleSize(bundleSize: ComparisonReport["bundleSize"]): void {
  logger.info("");
  logger.info(
    `Bundle size: ${formatBytes(bundleSize.minBytes)} minified, ${formatBytes(bundleSize.gzipBytes)} minified + gzip`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const pair = parseLibraryPairArg(argv);
  const repoRoot = getRepoRoot();
  const reportPath = resolveReportPath(argv, "comparison-report.json");
  const packageDir = resolveOpPackageDir(repoRoot);
  const fingerprint = readCurrentFingerprint(repoRoot);
  const packageVersion = await readPackageVersion(packageDir);

  logger.info(
    `Comparison target: @prodkit/op@${packageVersion} (${process.version}, ${process.platform}/${process.arch})`,
  );

  const scenarios: ComparisonReport["scenarios"] = [];
  for (const scenario of COMPARISON_SCENARIOS) {
    logger.info(`Benchmarking ${scenario.label}...`);
    const runtime = {} as Record<ImplementationId, RuntimeCell>;
    const descriptions = {} as Record<ImplementationId, string>;
    for (const column of IMPLEMENTATION_COLUMNS) {
      const cell = scenario.implementations[column.id];
      runtime[column.id] = await runTinybenchVariant(cell.benchName, cell.run);
      descriptions[column.id] = cell.description;
    }
    scenarios.push({
      key: scenario.key,
      label: scenario.label,
      descriptions,
      runtime,
      vsBaseline: computeVsBaseline(runtime),
    });
  }

  const bundleSize = await measureBundleSize(packageDir);
  const implementations = [...IMPLEMENTATION_COLUMNS];

  const report: ComparisonReport = {
    generatedAt: new Date().toISOString(),
    environment: readEnvironmentReport(),
    current: {
      headSha: fingerprint.headSha,
      dirty: fingerprint.dirty,
      packageVersion,
    },
    baselineId: BASELINE_IMPLEMENTATION_ID,
    implementations,
    scenarios,
    bundleSize,
    pair: pair === undefined ? undefined : buildPairReport(scenarios, pair),
  };

  printAbsoluteTable(scenarios, implementations);
  printVsBaselineTable(scenarios, implementations);
  if (pair !== undefined) {
    printPairTable(scenarios, implementations, pair);
  }
  printBundleSize(bundleSize);

  await writeJsonReport(reportPath, report);
  logger.info("");
  logger.info(`Wrote comparison report: ${path.resolve(reportPath)}`);
  logger.info(
    "Refresh packages/op/docs/performance.md with: pnpm --filter @prodkit/tools run performance:sync -- --write",
  );
}

main().catch((error) => {
  logger.error(error);
  process.exitCode = 1;
});
