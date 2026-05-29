import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";
import {
  COMPARISON_SCENARIOS,
  IMPLEMENTATION_COLUMNS,
  slowdownRatio,
  type ComparisonScenarioKey,
  type ImplementationId,
} from "./comparison-matrix.ts";
import {
  getRepoRoot,
  readEnvironmentReport,
  readPackageVersion,
  resolveOpPackageDir,
  resolveReportPath,
  runTinybenchVariant,
  writeJsonReport,
  type TinybenchRecord,
} from "./harness.ts";

type RuntimeCell = TinybenchRecord;

type ComparisonReport = {
  generatedAt: string;
  environment: ReturnType<typeof readEnvironmentReport>;
  current: {
    headSha: string;
    dirty: boolean;
    packageVersion: string;
  };
  implementations: Array<(typeof IMPLEMENTATION_COLUMNS)[number]>;
  scenarios: Array<{
    key: ComparisonScenarioKey;
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const repoRoot = getRepoRoot();
  const reportPath = resolveReportPath(argv, "comparison-report.json");
  const packageDir = resolveOpPackageDir(repoRoot);
  const fingerprint = readCurrentFingerprint(repoRoot);
  const packageVersion = await readPackageVersion(packageDir);

  logger.info(
    `Comparison environment: node=${process.version} platform=${process.platform} arch=${process.arch}`,
  );

  const scenarios: ComparisonReport["scenarios"] = [];
  for (const scenario of COMPARISON_SCENARIOS) {
    logger.info(`Benchmarking scenario ${scenario.key}...`);
    const native = await runTinybenchVariant(scenario.nativeBench, scenario.native);
    const op = await runTinybenchVariant(scenario.opBench, scenario.op);
    scenarios.push({
      key: scenario.key,
      label: scenario.label,
      descriptions: {
        native: scenario.nativeDescription,
        op: scenario.opDescription,
      },
      runtime: { native, op },
      slowdownRatio: slowdownRatio(native.hz, op.hz),
    });
  }

  const bundleSize = await measureBundleSize(packageDir);

  const report: ComparisonReport = {
    generatedAt: new Date().toISOString(),
    environment: readEnvironmentReport(),
    current: {
      headSha: fingerprint.headSha,
      dirty: fingerprint.dirty,
      packageVersion,
    },
    implementations: [...IMPLEMENTATION_COLUMNS],
    scenarios,
    bundleSize,
  };

  for (const scenario of scenarios) {
    logger.info(
      `- ${scenario.key}: slowdown=${scenario.slowdownRatio.toFixed(2)}x (native=${scenario.runtime.native.hz.toFixed(0)} hz, op=${scenario.runtime.op.hz.toFixed(0)} hz)`,
    );
  }

  await writeJsonReport(reportPath, report);
  logger.info(`Wrote comparison report: ${path.resolve(reportPath)}`);
}

main().catch((error) => {
  logger.error(error);
  process.exitCode = 1;
});
