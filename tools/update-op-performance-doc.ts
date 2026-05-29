import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createLogger } from "./logger.ts";
import { readRepoRoot } from "./utils.ts";

const logger = createLogger(import.meta.url);

const PERFORMANCE_DOC_REL = "packages/op/PERFORMANCE.md";
const DEFAULT_REPORT_REL = "benchmarks/op/comparison-report.json";
const REPO = "trvswgnr/prodkit";
const SNAPSHOT_START = "<!-- op-performance-snapshot:start -->";
const SNAPSHOT_END = "<!-- op-performance-snapshot:end -->";

type ImplementationId = "native" | "op";

type RuntimeCell = {
  hz: number;
  latencyMs: number;
};

type ComparisonReport = {
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
  implementations: Array<{
    id: ImplementationId;
    header: string;
    description: string;
  }>;
  scenarios: Array<{
    key: string;
    label: string;
    descriptions: Record<ImplementationId, string>;
    runtime: Record<ImplementationId, RuntimeCell>;
    slowdownRatio: number;
  }>;
  bundleSize: {
    minBytes: number;
    gzipBytes: number;
  };
};

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
    throw new Error(`comparison report is missing ${label}`);
  }
  return value;
}

function readNumberField(object: object, key: string, label: string): number {
  const value = Reflect.get(object, key);
  if (typeof value !== "number") {
    throw new Error(`comparison report is missing ${label}`);
  }
  return value;
}

function readRuntimeCell(value: unknown, label: string): RuntimeCell {
  if (typeof value !== "object" || value === null) {
    throw new Error(`comparison report is missing ${label}`);
  }
  return {
    hz: readNumberField(value, "hz", `${label}.hz`),
    latencyMs: readNumberField(value, "latencyMs", `${label}.latencyMs`),
  };
}

function readComparisonReport(reportPath: string): ComparisonReport {
  const raw = readFileSync(reportPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("comparison report must be a JSON object");
  }

  const generatedAt = readStringField(parsed, "generatedAt", "generatedAt");
  const environment = Reflect.get(parsed, "environment");
  if (typeof environment !== "object" || environment === null) {
    throw new Error("comparison report is missing environment");
  }

  const current = Reflect.get(parsed, "current");
  if (typeof current !== "object" || current === null) {
    throw new Error("comparison report is missing current");
  }

  const implementationsRaw = Reflect.get(parsed, "implementations");
  if (!Array.isArray(implementationsRaw) || implementationsRaw.length === 0) {
    throw new Error("comparison report is missing implementations");
  }

  const scenariosRaw = Reflect.get(parsed, "scenarios");
  if (!Array.isArray(scenariosRaw) || scenariosRaw.length === 0) {
    throw new Error("comparison report is missing scenarios");
  }

  const bundleSize = Reflect.get(parsed, "bundleSize");
  if (typeof bundleSize !== "object" || bundleSize === null) {
    throw new Error("comparison report is missing bundleSize");
  }

  const scenarios: ComparisonReport["scenarios"] = [];
  for (const item of scenariosRaw) {
    if (typeof item !== "object" || item === null) {
      throw new Error("comparison report scenarios must be objects");
    }
    const key = readStringField(item, "key", "scenarios[].key");
    const label = readStringField(item, "label", `scenarios.${key}.label`);
    const descriptions = Reflect.get(item, "descriptions");
    const runtime = Reflect.get(item, "runtime");
    if (typeof descriptions !== "object" || descriptions === null) {
      throw new Error(`comparison report is missing scenarios.${key}.descriptions`);
    }
    if (typeof runtime !== "object" || runtime === null) {
      throw new Error(`comparison report is missing scenarios.${key}.runtime`);
    }
    scenarios.push({
      key,
      label,
      descriptions: {
        native: readStringField(descriptions, "native", `scenarios.${key}.descriptions.native`),
        op: readStringField(descriptions, "op", `scenarios.${key}.descriptions.op`),
      },
      runtime: {
        native: readRuntimeCell(Reflect.get(runtime, "native"), `scenarios.${key}.runtime.native`),
        op: readRuntimeCell(Reflect.get(runtime, "op"), `scenarios.${key}.runtime.op`),
      },
      slowdownRatio: readNumberField(item, "slowdownRatio", `scenarios.${key}.slowdownRatio`),
    });
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
    implementations: implementationsRaw.map((item, index) => {
      if (typeof item !== "object" || item === null) {
        throw new Error(`comparison report implementations[${index}] must be an object`);
      }
      return {
        id: readStringField(item, "id", `implementations[${index}].id`) as ImplementationId,
        header: readStringField(item, "header", `implementations[${index}].header`),
        description: readStringField(item, "description", `implementations[${index}].description`),
      };
    }),
    scenarios,
    bundleSize: {
      minBytes: readNumberField(bundleSize, "minBytes", "bundleSize.minBytes"),
      gzipBytes: readNumberField(bundleSize, "gzipBytes", "bundleSize.gzipBytes"),
    },
  };
}

function renderSnapshot(report: ComparisonReport): string {
  const date = formatSnapshotDate(report.generatedAt);
  const shortSha = report.current.headSha.slice(0, 7);
  const commitUrl = `https://github.com/${REPO}/commit/${report.current.headSha}`;

  const runtimeRows = report.scenarios
    .map((scenario) => {
      const native = scenario.runtime.native;
      const op = scenario.runtime.op;
      return `| ${scenario.label} | ${scenario.descriptions.native} | ${formatHz(native.hz)} | ${scenario.descriptions.op} | ${formatHz(op.hz)} | ${formatRatio(scenario.slowdownRatio)} |`;
    })
    .join("\n");

  return [
    `Captured on **${date}** at commit [\`${shortSha}\`](${commitUrl}) (\`@prodkit/op@${report.current.packageVersion}\`).`,
    `Environment: ${report.environment.node}, ${report.environment.platform}/${report.environment.arch}.`,
    "Slowdown ratios compare `@prodkit/op` to native Promise equivalents on the same machine.",
    "Add competitor library columns by extending `IMPLEMENTATION_COLUMNS` in `benchmarks/op/comparison-matrix.ts`.",
    "",
    "### Runtime overhead",
    "",
    "| Scenario | Native baseline | Native ops/sec | @prodkit/op | Op ops/sec | Slowdown (Op vs native) |",
    "| --- | --- | --- | --- | --- | --- |",
    runtimeRows,
    "",
    "### Bundle size",
    "",
    "| Metric | Size |",
    "| --- | --- |",
    `| ESM entry minified | ${formatBytes(report.bundleSize.minBytes)} |`,
    `| ESM entry minified + gzip | ${formatBytes(report.bundleSize.gzipBytes)} |`,
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
      `missing comparison report at ${reportPath}. Run: pnpm --filter @prodkit/op-benchmarks run compare -- --report=comparison-report.json`,
    );
  }

  const report = readComparisonReport(reportPath);
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
