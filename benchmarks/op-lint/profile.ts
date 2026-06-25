import { statSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_BENCH_TIME_MS,
  DEFAULT_BENCH_WARMUP_ITERATIONS,
  DEFAULT_BENCH_WARMUP_TIME_MS,
  findNewestProfileArtifact,
  formatNumber,
  parseArgValue,
  parsePositiveInt,
  parseReportPath,
  readEnvironmentReport,
  runTinybenchVariant,
  writeJsonReport,
  type TinybenchRecord,
} from "../op/runtime/harness.ts";
import {
  ensureOpLintProfileDir,
  OP_LINT_PROFILE_DIR,
  readPackageVersion,
  resolveOpLintPackageDir,
  resolveOpLintProfileArtifact,
} from "./harness.ts";
import { createOpLintBenchmarkSuite, type OpLintBenchmarkScenario } from "./scenarios.ts";

type ProfileMode = "breakdown" | "cpu" | "heap";

type ScenarioRecord = TinybenchRecord & {
  description: string;
};

type ProfileReport = {
  environment: ReturnType<typeof readEnvironmentReport>;
  generatedAt: string;
  package: {
    name: "@prodkit/op-lint";
    version: string;
  };
  scenarios: Record<string, ScenarioRecord>;
};

const logger = console;

function parseProfileMode(argv: readonly string[]): ProfileMode {
  const value = parseArgValue(argv, "--profile-mode=");
  if (value === undefined) return "breakdown";
  if (value === "breakdown" || value === "cpu" || value === "heap") return value;
  throw new Error(`Invalid profile mode "${value}". Expected breakdown, cpu, or heap.`);
}

function selectScenarios(
  scenarios: readonly OpLintBenchmarkScenario[],
  filter: string | undefined,
): OpLintBenchmarkScenario[] {
  if (filter === undefined) return [...scenarios];

  const requested = new Set(filter.split(",").filter((item) => item.length > 0));
  const selected = scenarios.filter((scenario) => requested.has(scenario.name));
  const missing = [...requested].filter(
    (name) => !scenarios.some((scenario) => scenario.name === name),
  );
  if (missing.length > 0) {
    throw new Error(
      `Unknown op-lint profile scenario(s): ${missing.join(", ")}. Available: ${scenarios.map((scenario) => scenario.name).join(", ")}`,
    );
  }

  return selected;
}

async function measureScenario(scenario: OpLintBenchmarkScenario): Promise<ScenarioRecord> {
  const record = await runTinybenchVariant(scenario.name, scenario.run, {
    time: scenario.tinybench?.time ?? DEFAULT_BENCH_TIME_MS,
    warmupIterations: scenario.tinybench?.warmupIterations ?? DEFAULT_BENCH_WARMUP_ITERATIONS,
    warmupTime: scenario.tinybench?.warmupTime ?? DEFAULT_BENCH_WARMUP_TIME_MS,
  });
  return {
    ...record,
    description: scenario.description,
  };
}

async function runProfileLoop(
  scenario: OpLintBenchmarkScenario,
  profileMode: Exclude<ProfileMode, "breakdown">,
  iterations: number,
): Promise<void> {
  logger.info(`Profiling ${scenario.name} (${iterations.toLocaleString("en-US")} iterations)...`);
  if (scenario.name.endsWith(".oxlintCliProject")) {
    logger.info("CLI scenario profiles mostly show parent process wait time; use it for walltime.");
  }
  for (let index = 0; index < iterations; index += 1) {
    scenario.run();
  }
}

function statArtifactIsFresh(artifactPath: string, startedAt: number): boolean {
  return statSync(artifactPath).mtimeMs >= startedAt - 1_000;
}

function printSummary(report: ProfileReport): void {
  logger.info("");
  logger.info("op-lint profile breakdown (higher ops/sec is better):");
  logger.info("Scenario".padEnd(48) + "Ops/sec".padStart(14) + "  Mean ms");
  for (const [name, record] of Object.entries(report.scenarios)) {
    logger.info(
      `${name.padEnd(48)}${formatNumber(record.hz).padStart(14)}  ${record.latencyMs.toFixed(4)}`,
    );
  }
  logger.info("");
  logger.info("Machine-readable output:");
  logger.info(
    `  pnpm --filter @prodkit/benchmarks run profile:op-lint -- --report=${resolveOpLintProfileArtifact("profile.json")}`,
  );
  logger.info("");
  logger.info("CPU profile:");
  logger.info(
    "  pnpm --filter @prodkit/benchmarks run profile:op-lint:cpu -- --scenario=op-lint.requireYieldStar.typeAwareWarmProject",
  );
  logger.info(
    "  Open the emitted *.cpuprofile in .profiles/op-lint/ via Chrome DevTools or https://speedscope.app",
  );
  logger.info("");
  logger.info("Heap profile:");
  logger.info(
    "  pnpm --filter @prodkit/benchmarks run profile:op-lint:heap -- --scenario=op-lint.requireYieldStar.typeAwareWarmProject",
  );
  logger.info("  Open the emitted *.heapprofile in .profiles/op-lint/ via Chrome DevTools Memory");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const profileMode = parseProfileMode(argv);
  const scenarioFilter = parseArgValue(argv, "--scenario=");
  const reportPath = parseReportPath(argv) ?? resolveOpLintProfileArtifact("profile.json");
  const suite = createOpLintBenchmarkSuite();
  const selected = selectScenarios(suite.scenarios, scenarioFilter);

  try {
    logger.info(
      `Profile environment: node=${process.version} platform=${process.platform} arch=${process.arch}`,
    );
    logger.info(
      `Profile target: ${resolveOpLintPackageDir()} (@prodkit/op-lint@${readPackageVersion(resolveOpLintPackageDir())})`,
    );
    logger.info(`Profile mode: ${profileMode}`);

    if (profileMode === "cpu" || profileMode === "heap") {
      if (selected.length !== 1) {
        throw new Error(
          `${profileMode} mode requires exactly one --scenario=... (got ${selected.length}).`,
        );
      }
      const scenario = selected[0];
      if (scenario === undefined) throw new Error("No scenario selected.");

      const defaultIterations = scenario.profileIterations[profileMode];
      const iterations = parsePositiveInt(
        parseArgValue(argv, "--iterations=") ?? String(defaultIterations),
        "iterations",
      );

      await ensureOpLintProfileDir();
      const artifactsDir = path.resolve(OP_LINT_PROFILE_DIR);
      const startedAt = Date.now();
      await runProfileLoop(scenario, profileMode, iterations);
      const artifactPrefix = profileMode === "cpu" ? "CPU" : "Heap";
      const artifactPath = findNewestProfileArtifact(artifactsDir, artifactPrefix);
      logger.info("");
      if (artifactPath !== undefined && statArtifactIsFresh(artifactPath, startedAt)) {
        logger.info(`${artifactPrefix} profile written: ${artifactPath}`);
      } else {
        logger.info(
          `${artifactPrefix} profile should be written in ${artifactsDir} as ${artifactPrefix}.*`,
        );
      }
      return;
    }

    const records: Record<string, ScenarioRecord> = {};
    for (const scenario of selected) {
      records[scenario.name] = await measureScenario(scenario);
    }

    const report: ProfileReport = {
      environment: readEnvironmentReport(),
      generatedAt: new Date().toISOString(),
      package: {
        name: "@prodkit/op-lint",
        version: readPackageVersion(resolveOpLintPackageDir()),
      },
      scenarios: records,
    };

    printSummary(report);
    await writeJsonReport(reportPath, report);
    logger.info("");
    logger.info(`Wrote op-lint profile report: ${path.resolve(reportPath)}`);
  } finally {
    suite.cleanup();
  }
}

await main();
