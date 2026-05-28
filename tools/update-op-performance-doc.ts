import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createLogger } from "./logger.ts";
import { readRepoRoot } from "./utils.ts";

const logger = createLogger(import.meta.url);

const PERFORMANCE_DOC_REL = "packages/op/PERFORMANCE.md";
const DEFAULT_REPORT_REL = "benchmarks/op/report.json";
const REPO = "trvswgnr/prodkit";
const SNAPSHOT_START = "<!-- op-performance-snapshot:start -->";
const SNAPSHOT_END = "<!-- op-performance-snapshot:end -->";

type OverheadPairName = "singleOp" | "all" | "any" | "race" | "retry" | "timeout" | "compose";
type VariantName =
  | "singleOp.rawAsync"
  | "singleOp.opRun"
  | "all.promiseAll"
  | "all.opAll"
  | "any.handRolledFirstSuccess"
  | "any.opAny"
  | "race.handRolledFirstSettler"
  | "race.opRace"
  | "retry.handRolled"
  | "retry.opWithRetry"
  | "timeout.promiseRace"
  | "timeout.opWithTimeout"
  | "compose.asyncSteps"
  | "compose.opYieldChain";

type BenchmarkRecord = {
  hz: number;
  latencyMs: number;
};

type BenchmarkReport = {
  generatedAt: string;
  environment: {
    node: string;
    platform: string;
    arch: string;
  };
  current: {
    headSha: string;
    packageVersion: string;
  };
  overhead: Record<OverheadPairName, { slowdownRatio: number }>;
  runtime: Record<VariantName, { current: BenchmarkRecord }>;
  bundleSize: {
    current: {
      minBytes: number;
      gzipBytes: number;
    };
  };
};

const SCENARIOS: Array<{
  key: OverheadPairName;
  label: string;
  native: string;
  op: string;
  reference: VariantName;
  variant: VariantName;
}> = [
  {
    key: "singleOp",
    label: "Single value",
    native: "`Promise.resolve(x)`",
    op: "`Op.of(x).run()`",
    reference: "singleOp.rawAsync",
    variant: "singleOp.opRun",
  },
  {
    key: "all",
    label: "Parallel batch (8 children)",
    native: "`Promise.all([...])`",
    op: "`Op.all([...]).run()`",
    reference: "all.promiseAll",
    variant: "all.opAll",
  },
  {
    key: "any",
    label: "First success (8 children)",
    native: "Hand-rolled first success + abort",
    op: "`Op.any([...]).run()`",
    reference: "any.handRolledFirstSuccess",
    variant: "any.opAny",
  },
  {
    key: "race",
    label: "First settler (8 children)",
    native: "Hand-rolled first settler + abort",
    op: "`Op.race([...]).run()`",
    reference: "race.handRolledFirstSettler",
    variant: "race.opRace",
  },
  {
    key: "retry",
    label: "Retry loop",
    native: "Hand-rolled try/catch retry",
    op: "`Op.try(...).withRetry(...).run()`",
    reference: "retry.handRolled",
    variant: "retry.opWithRetry",
  },
  {
    key: "timeout",
    label: "Timeout guard",
    native: "`Promise.race` + `setTimeout`",
    op: "`Op.of(x).withTimeout(ms).run()`",
    reference: "timeout.promiseRace",
    variant: "timeout.opWithTimeout",
  },
  {
    key: "compose",
    label: "Sequential compose (6 steps)",
    native: "`await Promise.resolve` chain",
    op: "`yield* Op.of` generator chain",
    reference: "compose.asyncSteps",
    variant: "compose.opYieldChain",
  },
];

function parseReportArg(argv: readonly string[]): string | undefined {
  const arg = argv.find((item) => item.startsWith("--report="));
  if (!arg) return undefined;
  return arg.slice("--report=".length);
}

function formatBytes(bytes: number): string {
  return `${Intl.NumberFormat("en-US").format(bytes)} B`;
}

function formatHz(hz: number): string {
  return Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(hz);
}

function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}x`;
}

function formatSnapshotDate(iso: string): string {
  const date = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`invalid generatedAt timestamp: ${iso}`);
  }
  return date;
}

function readStringField(object: object, key: string, label: string): string {
  const value = Reflect.get(object, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`benchmark report is missing ${label}`);
  }
  return value;
}

function readNumberField(object: object, key: string, label: string): number {
  const value = Reflect.get(object, key);
  if (typeof value !== "number") {
    throw new Error(`benchmark report is missing ${label}`);
  }
  return value;
}

function readBenchmarkRecord(object: object, label: string): BenchmarkRecord {
  return {
    hz: readNumberField(object, "hz", `${label}.hz`),
    latencyMs: readNumberField(object, "latencyMs", `${label}.latencyMs`),
  };
}

function readBenchmarkReport(reportPath: string): BenchmarkReport {
  const raw = readFileSync(reportPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("benchmark report must be a JSON object");
  }

  const generatedAt = readStringField(parsed, "generatedAt", "generatedAt");
  const environment = Reflect.get(parsed, "environment");
  if (typeof environment !== "object" || environment === null) {
    throw new Error("benchmark report is missing environment");
  }

  const current = Reflect.get(parsed, "current");
  if (typeof current !== "object" || current === null) {
    throw new Error("benchmark report is missing current");
  }

  const overhead = Reflect.get(parsed, "overhead");
  if (typeof overhead !== "object" || overhead === null) {
    throw new Error("benchmark report is missing overhead");
  }

  const runtime = Reflect.get(parsed, "runtime");
  if (typeof runtime !== "object" || runtime === null) {
    throw new Error("benchmark report is missing runtime");
  }

  const bundleSize = Reflect.get(parsed, "bundleSize");
  if (typeof bundleSize !== "object" || bundleSize === null) {
    throw new Error("benchmark report is missing bundleSize");
  }

  const currentSize = Reflect.get(bundleSize, "current");
  if (typeof currentSize !== "object" || currentSize === null) {
    throw new Error("benchmark report is missing bundleSize.current");
  }

  const overheadPairs = {} as BenchmarkReport["overhead"];
  const runtimeRecords = {} as BenchmarkReport["runtime"];

  for (const scenario of SCENARIOS) {
    const pair = Reflect.get(overhead, scenario.key);
    if (typeof pair !== "object" || pair === null) {
      throw new Error(`benchmark report is missing overhead.${scenario.key}`);
    }
    overheadPairs[scenario.key] = {
      slowdownRatio: readNumberField(
        pair,
        "slowdownRatio",
        `overhead.${scenario.key}.slowdownRatio`,
      ),
    };

    for (const variantName of [scenario.reference, scenario.variant] as const) {
      const variant = Reflect.get(runtime, variantName);
      if (typeof variant !== "object" || variant === null) {
        throw new Error(`benchmark report is missing runtime.${variantName}`);
      }
      const currentRecord = Reflect.get(variant, "current");
      if (typeof currentRecord !== "object" || currentRecord === null) {
        throw new Error(`benchmark report is missing runtime.${variantName}.current`);
      }
      runtimeRecords[variantName] = {
        current: readBenchmarkRecord(currentRecord, `runtime.${variantName}.current`),
      };
    }
  }

  return {
    generatedAt,
    environment: {
      node: readStringField(environment, "node", "environment.node"),
      platform: readStringField(environment, "platform", "environment.platform"),
      arch: readStringField(environment, "arch", "environment.arch"),
    },
    current: {
      headSha: readStringField(current, "headSha", "current.headSha"),
      packageVersion: readStringField(current, "packageVersion", "current.packageVersion"),
    },
    overhead: overheadPairs,
    runtime: runtimeRecords,
    bundleSize: {
      current: {
        minBytes: readNumberField(currentSize, "minBytes", "bundleSize.current.minBytes"),
        gzipBytes: readNumberField(currentSize, "gzipBytes", "bundleSize.current.gzipBytes"),
      },
    },
  };
}

function renderSnapshot(report: BenchmarkReport): string {
  const date = formatSnapshotDate(report.generatedAt);
  const shortSha = report.current.headSha.slice(0, 7);
  const commitUrl = `https://github.com/${REPO}/commit/${report.current.headSha}`;

  const runtimeRows = SCENARIOS.map((scenario) => {
    const reference = report.runtime[scenario.reference].current;
    const variant = report.runtime[scenario.variant].current;
    const ratio = report.overhead[scenario.key].slowdownRatio;
    return `| ${scenario.label} | ${scenario.native} | ${formatHz(reference.hz)} | ${scenario.op} | ${formatHz(variant.hz)} | ${formatRatio(ratio)} |`;
  }).join("\n");

  return [
    `Captured on **${date}** at commit [\`${shortSha}\`](${commitUrl}) (\`@prodkit/op@${report.current.packageVersion}\`).`,
    `Environment: ${report.environment.node}, ${report.environment.platform}/${report.environment.arch}.`,
    "Slowdown ratios compare Op paths to native Promise equivalents on the same machine.",
    "",
    "### Runtime overhead",
    "",
    "| Scenario | Native baseline | Native ops/sec | Op variant | Op ops/sec | Slowdown |",
    "| --- | --- | --- | --- | --- | --- |",
    runtimeRows,
    "",
    "### Bundle size",
    "",
    "| Metric | Size |",
    "| --- | --- |",
    `| ESM entry minified | ${formatBytes(report.bundleSize.current.minBytes)} |`,
    `| ESM entry minified + gzip | ${formatBytes(report.bundleSize.current.gzipBytes)} |`,
  ].join("\n");
}

function replaceSnapshot(document: string, snapshot: string): string {
  const start = document.indexOf(SNAPSHOT_START);
  const end = document.indexOf(SNAPSHOT_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `${PERFORMANCE_DOC_REL} is missing ${SNAPSHOT_START} / ${SNAPSHOT_END} markers`,
    );
  }

  const before = document.slice(0, start + SNAPSHOT_START.length);
  const after = document.slice(end);
  return `${before}\n\n${snapshot}\n\n${after}`;
}

function main(): void {
  const write = process.argv.includes("--write");
  const reportArg = parseReportArg(process.argv.slice(2));
  const root = readRepoRoot();
  const documentPath = path.join(root, PERFORMANCE_DOC_REL);
  const reportPath = path.resolve(root, reportArg ?? DEFAULT_REPORT_REL);

  if (!existsSync(documentPath)) {
    throw new Error(`missing ${PERFORMANCE_DOC_REL}`);
  }
  if (!existsSync(reportPath)) {
    throw new Error(
      `missing benchmark report at ${reportPath}. Run: pnpm --filter @prodkit/op-benchmarks run bench -- --report=report.json`,
    );
  }

  const report = readBenchmarkReport(reportPath);
  const snapshot = renderSnapshot(report);
  const document = readFileSync(documentPath, "utf8");
  const expected = replaceSnapshot(document, snapshot);

  if (document === expected) {
    logger.info("Op performance doc snapshot is up to date");
    process.exit(0);
  }

  if (write) {
    writeFileSync(documentPath, expected, "utf8");
    logger.info(`updated ${PERFORMANCE_DOC_REL} snapshot`);
    process.exit(0);
  }

  logger.error(
    "Op performance doc snapshot is out of date. Run: pnpm --filter @prodkit/tools run performance:sync -- --write",
  );
  process.exit(1);
}

try {
  main();
} catch (error) {
  logger.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
