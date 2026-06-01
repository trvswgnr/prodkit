import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createLogger } from "./logger.ts";
import { readRepoRoot } from "./utils.ts";

const logger = createLogger(import.meta.url);

const PERFORMANCE_DOC_REL = "packages/op/docs/performance.md";
const DEFAULT_REPORT_REL = "benchmarks/op/.artifacts/comparison-report.json";
const REPO = "trvswgnr/prodkit";
const SNAPSHOT_START = "<!-- op-performance-snapshot:start -->";
const SNAPSHOT_END = "<!-- op-performance-snapshot:end -->";

type RuntimeCell = {
  hz: number;
  latencyMs: number;
};

type ImplementationRecord = {
  id: string;
  header: string;
  description: string;
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
  baselineId: string;
  implementations: ImplementationRecord[];
  scenarios: Array<{
    key: string;
    label: string;
    descriptions: Record<string, string>;
    runtime: Record<string, RuntimeCell>;
    vsBaseline: Record<string, number>;
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

function formatVsBaseline(ratio: number): string {
  if (ratio >= 1) return `${ratio.toFixed(2)}x`;
  return `${(1 / ratio).toFixed(2)}x faster`;
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
  const baselineId = readStringField(parsed, "baselineId", "baselineId");
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

  const implementations = implementationsRaw.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`comparison report implementations[${index}] must be an object`);
    }
    return {
      id: readStringField(item, "id", `implementations[${index}].id`),
      header: readStringField(item, "header", `implementations[${index}].header`),
      description: readStringField(item, "description", `implementations[${index}].description`),
    };
  });

  if (implementations[0]?.id !== baselineId) {
    throw new Error(
      `comparison report baselineId "${baselineId}" must match the first implementation column`,
    );
  }

  const scenariosRaw = Reflect.get(parsed, "scenarios");
  if (!Array.isArray(scenariosRaw) || scenariosRaw.length === 0) {
    throw new Error("comparison report is missing scenarios");
  }

  const bundleSize = Reflect.get(parsed, "bundleSize");
  if (typeof bundleSize !== "object" || bundleSize === null) {
    throw new Error("comparison report is missing bundleSize");
  }

  const competitorIds = implementations.slice(1).map((column) => column.id);
  const scenarios: ComparisonReport["scenarios"] = [];
  for (const item of scenariosRaw) {
    if (typeof item !== "object" || item === null) {
      throw new Error("comparison report scenarios must be objects");
    }
    const key = readStringField(item, "key", "scenarios[].key");
    const label = readStringField(item, "label", `scenarios.${key}.label`);
    const descriptionsRaw = Reflect.get(item, "descriptions");
    const runtimeRaw = Reflect.get(item, "runtime");
    const vsBaselineRaw = Reflect.get(item, "vsBaseline");
    if (typeof descriptionsRaw !== "object" || descriptionsRaw === null) {
      throw new Error(`comparison report is missing scenarios.${key}.descriptions`);
    }
    if (typeof runtimeRaw !== "object" || runtimeRaw === null) {
      throw new Error(`comparison report is missing scenarios.${key}.runtime`);
    }
    if (typeof vsBaselineRaw !== "object" || vsBaselineRaw === null) {
      throw new Error(`comparison report is missing scenarios.${key}.vsBaseline`);
    }

    const descriptions: Record<string, string> = {};
    const runtime: Record<string, RuntimeCell> = {};
    const vsBaseline: Record<string, number> = {};
    for (const column of implementations) {
      descriptions[column.id] = readStringField(
        descriptionsRaw,
        column.id,
        `scenarios.${key}.descriptions.${column.id}`,
      );
      runtime[column.id] = readRuntimeCell(
        Reflect.get(runtimeRaw, column.id),
        `scenarios.${key}.runtime.${column.id}`,
      );
    }
    for (const competitorId of competitorIds) {
      vsBaseline[competitorId] = readNumberField(
        vsBaselineRaw,
        competitorId,
        `scenarios.${key}.vsBaseline.${competitorId}`,
      );
    }

    scenarios.push({ key, label, descriptions, runtime, vsBaseline });
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
    baselineId,
    implementations,
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
  const baseline = report.implementations[0];
  if (baseline === undefined) {
    throw new Error("comparison report is missing baseline implementation column");
  }
  const competitors = report.implementations.slice(1);

  const headerCells = [
    "Scenario",
    `${baseline.header}`,
    `${baseline.header} ops/sec`,
    ...competitors.flatMap((column) => [
      column.header,
      `${column.header} ops/sec`,
      `${column.header} vs native`,
    ]),
  ];
  const separatorCells = headerCells.map(() => "---");
  const headerRow = `| ${headerCells.join(" | ")} |`;
  const separatorRow = `| ${separatorCells.join(" | ")} |`;

  const runtimeRows = report.scenarios
    .map((scenario) => {
      const cells = [
        scenario.label,
        scenario.descriptions[baseline.id],
        formatHz(scenario.runtime[baseline.id]?.hz ?? 0),
        ...competitors.flatMap((column) => [
          scenario.descriptions[column.id],
          formatHz(scenario.runtime[column.id]?.hz ?? 0),
          formatVsBaseline(scenario.vsBaseline[column.id] ?? 0),
        ]),
      ];
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");

  const competitorNote =
    competitors.length === 1
      ? `\`${competitors[0]?.header}\` ratios use native ops/sec divided by library ops/sec (values above 1x mean slower than native).`
      : "Versus-native ratios use native ops/sec divided by library ops/sec (values above 1x mean slower than native).";

  return [
    `Captured on **${date}** at commit [\`${shortSha}\`](${commitUrl}) (\`@prodkit/op@${report.current.packageVersion}\`).`,
    `Environment: ${report.environment.node}, ${report.environment.platform}/${report.environment.arch}.`,
    competitorNote,
    "Add library columns by extending `IMPLEMENTATION_COLUMNS` and scenario implementations in `benchmarks/op/comparison-matrix.ts`.",
    "",
    "### Runtime overhead",
    "",
    headerRow,
    separatorRow,
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
      `missing comparison report at ${reportPath}. Run: pnpm --filter @prodkit/benchmarks run compare`,
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
