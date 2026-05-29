import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { transform } from "esbuild";
import {
  assertBenchOpFactory,
  formatNumber,
  formatPercentDelta,
  getRepoRoot,
  importOpModule,
  isRecord,
  OP_PACKAGE,
  parseReportPath,
  percentDelta,
  resolveBundleEntry,
  resolveOpPackageDir,
  runTinybenchVariant,
  writeJsonReport,
} from "./harness.ts";
import { runAsyncChain, runOpYieldChain } from "./scenarios.ts";

type BaselineKind = "main" | "npm";
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

type RuntimeReport = Record<VariantName, BenchmarkRecord>;

type SizeReport = {
  minBytes: number;
  gzipBytes: number;
};

type OverheadPairName = "singleOp" | "all" | "any" | "race" | "retry" | "timeout" | "compose";

type OverheadPair = {
  reference: VariantName;
  variant: VariantName;
  slowdownRatio: number;
};

type BenchmarkReport = {
  generatedAt: string;
  environment: {
    node: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  baselineKind: BaselineKind;
  current: {
    label: string;
    headSha: string;
    dirty: boolean;
    packageVersion: string;
  };
  baseline: {
    label: string;
    packageVersion: string;
  };
  runtime: Record<
    VariantName,
    {
      current: BenchmarkRecord;
      baseline: BenchmarkRecord;
      deltaPercent: number | null;
    }
  >;
  overhead: Record<OverheadPairName, OverheadPair>;
  bundleSize: {
    current: SizeReport;
    baseline: SizeReport;
    minifiedDeltaPercent: number | null;
    gzipDeltaPercent: number | null;
  };
};

type TargetInstall = {
  label: string;
  workspaceDir: string;
  packageDir: string;
  packageVersion: string;
};

const REPO = "trvswgnr/prodkit";
const MAIN_REF = "refs/heads/main";
const MAIN_REMOTE_URL = `https://github.com/${REPO}.git`;
const CONCURRENCY_CHILDREN = 8;
const RETRY_ATTEMPTS = 3;
const TIMEOUT_BUDGET_MS = 250;
const logger = console;

function parseBaselineArg(argv: readonly string[]): BaselineKind {
  const arg = argv.find((item) => item.startsWith("--baseline="));
  if (!arg) return "main";
  const value = arg.slice("--baseline=".length);
  if (value === "main" || value === "npm") return value;
  throw new Error(`Invalid baseline "${value}". Expected "main" or "npm".`);
}

function parseLsRemoteSha(output: string): string | undefined {
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const [sha, resolvedRef] = line.split(/\s+/, 2);
    if (resolvedRef !== MAIN_REF) continue;
    if (sha?.match(/^[0-9a-f]{40}$/i)) return sha.toLowerCase();
  }
  return undefined;
}

function parsePackFilename(packOutput: string): string {
  const parsed = JSON.parse(packOutput);
  if (!Array.isArray(parsed)) {
    throw new Error("Could not parse npm pack output filename.");
  }
  const filename = parsed[0]?.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("Could not parse npm pack output filename.");
  }
  return filename;
}

async function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  capture: boolean = false,
): Promise<string> {
  const invocation = `${command} ${args.join(" ")}`;
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    if (capture && child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }
    if (capture && child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (status, signal) => {
      if (status === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `${invocation} failed with status=${String(status)} signal=${String(signal)}\n${stderr}`.trim(),
        ),
      );
    });
  });
}

async function resolveMainCommitSha(repoRoot: string): Promise<string> {
  const output = await runCommand(
    "git",
    ["ls-remote", "--refs", MAIN_REMOTE_URL, MAIN_REF],
    repoRoot,
    true,
  );
  const sha = parseLsRemoteSha(output);
  if (!sha) {
    throw new Error(`Unable to resolve latest main commit via ${MAIN_REMOTE_URL} ${MAIN_REF}.`);
  }
  return sha;
}

async function resolveCurrentFingerprint(
  repoRoot: string,
): Promise<{ headSha: string; dirty: boolean }> {
  const headOutput = await runCommand("git", ["rev-parse", "HEAD"], repoRoot, true);
  const headSha = headOutput.trim().toLowerCase();
  if (!headSha.match(/^[0-9a-f]{40}$/)) {
    throw new Error(`Unable to resolve local HEAD SHA: ${headOutput}`);
  }
  const statusOutput = await runCommand("git", ["status", "--porcelain"], repoRoot, true);
  return { headSha, dirty: statusOutput.trim().length > 0 };
}

async function installTarget(label: string, spec: string): Promise<TargetInstall> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "op-bench-"));
  let installSpec = spec;
  if (existsSync(spec)) {
    const localTarballName = `${label}.tgz`;
    const localTarballPath = path.join(workspaceDir, localTarballName);
    await copyFile(spec, localTarballPath);
    installSpec = `./${localTarballName}`;
  }

  const packageJson = {
    name: "op-bench-target",
    private: true,
    type: "module",
    dependencies: {},
  };

  await writeFile(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(packageJson, null, 2) + "\n",
  );
  await runCommand(
    "npm",
    [
      "install",
      "--no-package-lock",
      "--install-strategy=hoisted",
      "--install-links=false",
      installSpec,
    ],
    workspaceDir,
  );

  const packageDirCandidates = [
    path.join(workspaceDir, "node_modules", "@prodkit", "op"),
    path.join(workspaceDir, "node_modules", "op"),
  ];
  const packageDir = packageDirCandidates.find((candidate) => existsSync(candidate));
  if (!packageDir) {
    throw new Error(`Install succeeded but ${OP_PACKAGE} was not found in ${workspaceDir}.`);
  }

  const packageJsonRaw = await readFile(path.join(packageDir, "package.json"), "utf8");
  const parsed: unknown = JSON.parse(packageJsonRaw);
  if (!isRecord(parsed)) {
    throw new Error("Could not parse package.json.");
  }
  const packageVersion = parsed.version ?? "unknown";
  if (typeof packageVersion !== "string") {
    throw new Error("Could not parse package.json version.");
  }

  return { label, workspaceDir, packageDir, packageVersion };
}

async function resolveCurrentTarball(repoRoot: string): Promise<string> {
  const packageDir = resolveOpPackageDir(repoRoot);
  logger.info(`Building current package in ${packageDir}`);
  await runCommand("npm", ["run", "build"], packageDir);
  logger.info(`Built current package in ${packageDir}`);
  const packOutput = await runCommand(
    "npm",
    ["pack", "--json", "--ignore-scripts"],
    packageDir,
    true,
  );
  logger.info(`Packed current package in ${packageDir}`);
  const filename = parsePackFilename(packOutput);
  logger.info(`Parsed pack filename: ${filename}`);
  return path.resolve(packageDir, filename);
}

async function resolveMainTarball(repoRoot: string, sha: string): Promise<string> {
  const worktreeDir = await mkdtemp(path.join(os.tmpdir(), "op-bench-main-"));
  let createdTarballPath: string | undefined;
  let failure: unknown;

  await runCommand("git", ["worktree", "add", "--detach", worktreeDir, sha], repoRoot);
  try {
    await runCommand("pnpm", ["install", "--no-frozen-lockfile"], worktreeDir);
    const packageDir = resolveOpPackageDir(worktreeDir);
    await runCommand("npm", ["run", "build"], packageDir);
    const packOutput = await runCommand(
      "npm",
      ["pack", "--json", "--ignore-scripts"],
      packageDir,
      true,
    );
    const filename = parsePackFilename(packOutput);
    const packedTarball = path.resolve(packageDir, filename);
    const copiedTarball = path.resolve(repoRoot, `main-${sha.slice(0, 12)}.tgz`);
    await copyFile(packedTarball, copiedTarball);
    createdTarballPath = copiedTarball;
  } catch (error) {
    failure = error;
  }

  await runCommand("git", ["worktree", "remove", "--force", worktreeDir], repoRoot).catch(
    () => undefined,
  );

  if (failure !== undefined) throw failure;
  if (!createdTarballPath) {
    throw new Error(`Failed to create benchmark tarball for main@${sha}`);
  }
  return createdTarballPath;
}

async function importOpFactory(packageDir: string): Promise<{ Op: unknown }> {
  return importOpModule(packageDir);
}

async function runVariant(name: string, fn: () => Promise<unknown>): Promise<BenchmarkRecord> {
  const record = await runTinybenchVariant(name, fn);
  return { hz: record.hz, latencyMs: record.latencyMs };
}

async function handRolledFirstSettler(childCount: number): Promise<void> {
  let winner: number | undefined;
  const controllers = Array.from({ length: childCount }, () => new AbortController());
  await Promise.all(
    Array.from({ length: childCount }, (_, index) =>
      Promise.resolve(index).then((value) => {
        if (winner === undefined) {
          winner = value;
          controllers.forEach((controller, controllerIndex) => {
            if (controllerIndex !== index) controller.abort();
          });
        }
        return value;
      }),
    ),
  );
  if (winner === undefined) {
    throw new Error("handRolledFirstSettler exhausted unexpectedly.");
  }
}

async function runRuntimeBenchmarks(opFactoryInput: unknown): Promise<RuntimeReport> {
  const Op = assertBenchOpFactory(opFactoryInput);
  const report: Partial<RuntimeReport> = {};

  report["singleOp.rawAsync"] = await runVariant("singleOp.rawAsync", async () => {
    await Promise.resolve(69);
  });

  report["singleOp.opRun"] = await runVariant("singleOp.opRun", async () => {
    const result = await Op.of(69).run();
    if (!result.isOk()) throw new Error("singleOp.opRun failed unexpectedly.");
  });

  report["all.promiseAll"] = await runVariant("all.promiseAll", async () => {
    await Promise.all(
      Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Promise.resolve(index)),
    );
  });

  report["all.opAll"] = await runVariant("all.opAll", async () => {
    const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
    const result = await Op.all(ops).run();
    if (!result.isOk()) throw new Error("all.opAll failed unexpectedly.");
  });

  report["any.handRolledFirstSuccess"] = await runVariant(
    "any.handRolledFirstSuccess",
    async () => {
      await handRolledFirstSettler(CONCURRENCY_CHILDREN);
    },
  );

  report["any.opAny"] = await runVariant("any.opAny", async () => {
    const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
    const result = await Op.any(ops).run();
    if (!result.isOk()) throw new Error("any.opAny failed unexpectedly.");
  });

  report["race.handRolledFirstSettler"] = await runVariant(
    "race.handRolledFirstSettler",
    async () => {
      await handRolledFirstSettler(CONCURRENCY_CHILDREN);
    },
  );

  report["race.opRace"] = await runVariant("race.opRace", async () => {
    const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
    const result = await Op.race(ops).run();
    if (!result.isOk()) throw new Error("race.opRace failed unexpectedly.");
  });

  report["retry.handRolled"] = await runVariant("retry.handRolled", async () => {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        if (attempt < RETRY_ATTEMPTS) throw new Error("retry");
        break;
      } catch {
        if (attempt >= RETRY_ATTEMPTS) throw new Error("retry.handRolled exhausted unexpectedly.");
      }
    }
  });

  report["retry.opWithRetry"] = await runVariant("retry.opWithRetry", async () => {
    let attempt = 0;
    const result = await Op.try(() => {
      attempt += 1;
      if (attempt < RETRY_ATTEMPTS) throw new Error("retry");
      return 1;
    })
      .withRetry({
        maxAttempts: RETRY_ATTEMPTS,
        shouldRetry: () => true,
        getDelay: () => 0,
      })
      .run();
    if (!result.isOk()) throw new Error("retry.opWithRetry failed unexpectedly.");
  });

  report["timeout.promiseRace"] = await runVariant("timeout.promiseRace", async () => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        reject(new Error("timeout should not fire"));
      }, TIMEOUT_BUDGET_MS);
    });
    await Promise.race([Promise.resolve(7), timer]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });

  report["timeout.opWithTimeout"] = await runVariant("timeout.opWithTimeout", async () => {
    const result = await Op.of(7).withTimeout(TIMEOUT_BUDGET_MS).run();
    if (!result.isOk()) throw new Error("timeout.opWithTimeout failed unexpectedly.");
  });

  report["compose.asyncSteps"] = await runVariant("compose.asyncSteps", () => runAsyncChain());

  report["compose.opYieldChain"] = await runVariant("compose.opYieldChain", () =>
    runOpYieldChain(Op),
  );

  return report as RuntimeReport;
}

async function measureBundleSize(packageDir: string): Promise<SizeReport> {
  const entryPath = await resolveBundleEntry(packageDir);
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

function slowdownRatio(referenceHz: number, variantHz: number): number {
  if (variantHz === 0) return 0;
  return referenceHz / variantHz;
}

const RUNTIME_VARIANTS: VariantName[] = [
  "singleOp.rawAsync",
  "singleOp.opRun",
  "all.promiseAll",
  "all.opAll",
  "any.handRolledFirstSuccess",
  "any.opAny",
  "race.handRolledFirstSettler",
  "race.opRace",
  "retry.handRolled",
  "retry.opWithRetry",
  "timeout.promiseRace",
  "timeout.opWithTimeout",
  "compose.asyncSteps",
  "compose.opYieldChain",
];

const OVERHEAD_PAIRS: Record<OverheadPairName, { reference: VariantName; variant: VariantName }> = {
  singleOp: { reference: "singleOp.rawAsync", variant: "singleOp.opRun" },
  all: { reference: "all.promiseAll", variant: "all.opAll" },
  any: { reference: "any.handRolledFirstSuccess", variant: "any.opAny" },
  race: { reference: "race.handRolledFirstSettler", variant: "race.opRace" },
  retry: { reference: "retry.handRolled", variant: "retry.opWithRetry" },
  timeout: { reference: "timeout.promiseRace", variant: "timeout.opWithTimeout" },
  compose: { reference: "compose.asyncSteps", variant: "compose.opYieldChain" },
};

function buildBenchmarkReport(input: {
  baselineKind: BaselineKind;
  currentLabel: string;
  currentFingerprint: { headSha: string; dirty: boolean };
  currentVersion: string;
  baselineLabel: string;
  baselineVersion: string;
  currentRuntime: RuntimeReport;
  baselineRuntime: RuntimeReport;
  currentSize: SizeReport;
  baselineSize: SizeReport;
}): BenchmarkReport {
  const runtime = {} as BenchmarkReport["runtime"];
  for (const name of RUNTIME_VARIANTS) {
    runtime[name] = {
      current: input.currentRuntime[name],
      baseline: input.baselineRuntime[name],
      deltaPercent: percentDelta(input.currentRuntime[name].hz, input.baselineRuntime[name].hz),
    };
  }

  const overhead = {} as BenchmarkReport["overhead"];
  for (const [name, pair] of Object.entries(OVERHEAD_PAIRS) as Array<
    [OverheadPairName, { reference: VariantName; variant: VariantName }]
  >) {
    overhead[name] = {
      reference: pair.reference,
      variant: pair.variant,
      slowdownRatio: slowdownRatio(
        input.baselineRuntime[pair.reference].hz,
        input.baselineRuntime[pair.variant].hz,
      ),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    baselineKind: input.baselineKind,
    current: {
      label: input.currentLabel,
      headSha: input.currentFingerprint.headSha,
      dirty: input.currentFingerprint.dirty,
      packageVersion: input.currentVersion,
    },
    baseline: {
      label: input.baselineLabel,
      packageVersion: input.baselineVersion,
    },
    runtime,
    overhead,
    bundleSize: {
      current: input.currentSize,
      baseline: input.baselineSize,
      minifiedDeltaPercent: percentDelta(input.currentSize.minBytes, input.baselineSize.minBytes),
      gzipDeltaPercent: percentDelta(input.currentSize.gzipBytes, input.baselineSize.gzipBytes),
    },
  };
}

function printRuntimeComparison(current: RuntimeReport, baseline: RuntimeReport): void {
  logger.info("Runtime benchmarks (ops/sec, higher is better):");
  for (const name of RUNTIME_VARIANTS) {
    const currentHz = current[name].hz;
    const baselineHz = baseline[name].hz;
    const delta = formatPercentDelta(currentHz, baselineHz);
    logger.info(
      `- ${name}: current=${formatNumber(currentHz)} baseline=${formatNumber(baselineHz)} delta=${delta}`,
    );
  }
}

function printBundleComparison(current: SizeReport, baseline: SizeReport): void {
  logger.info("Bundle size benchmarks (lower is better):");
  logger.info(
    `- minified bytes: current=${formatNumber(current.minBytes)} baseline=${formatNumber(
      baseline.minBytes,
    )} delta=${formatPercentDelta(current.minBytes, baseline.minBytes)}`,
  );
  logger.info(
    `- gzip bytes: current=${formatNumber(current.gzipBytes)} baseline=${formatNumber(
      baseline.gzipBytes,
    )} delta=${formatPercentDelta(current.gzipBytes, baseline.gzipBytes)}`,
  );
}

function printOverheadSummary(report: BenchmarkReport): void {
  logger.info(
    "Op overhead vs native Promise baselines (baseline slowdown ratio, higher is slower):",
  );
  for (const [name, pair] of Object.entries(report.overhead) as Array<
    [OverheadPairName, OverheadPair]
  >) {
    logger.info(
      `- ${name}: ${pair.variant} vs ${pair.reference} = ${pair.slowdownRatio.toFixed(2)}x`,
    );
  }
}

async function runCleanup(cleanups: Array<() => Promise<void>>): Promise<void> {
  for (let index = cleanups.length - 1; index >= 0; index -= 1) {
    const cleanup = cleanups[index];
    if (!cleanup) continue;
    await cleanup();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const repoRoot = getRepoRoot();
  const baselineKind = parseBaselineArg(argv);
  const reportPath = parseReportPath(argv);
  const cleanups: Array<() => Promise<void>> = [];
  let failure: unknown;

  logger.info(
    `Benchmark environment: node=${process.version} platform=${process.platform} arch=${process.arch}`,
  );
  logger.info(`Benchmark baseline mode: ${baselineKind}`);

  try {
    const currentFingerprint = await resolveCurrentFingerprint(repoRoot);
    const currentLabel = `local@${currentFingerprint.headSha.slice(0, 12)}${currentFingerprint.dirty ? "+dirty" : "+clean"}`;

    logger.info(`Resolving current tarball in ${repoRoot}`);
    const currentTarball = await resolveCurrentTarball(repoRoot);
    logger.info(`Resolved current tarball: ${currentTarball}`);
    cleanups.push(async () => {
      if (existsSync(currentTarball)) await rm(currentTarball, { force: true });
    });

    const currentTarget = await installTarget("current", currentTarball);
    cleanups.push(async () => {
      if (existsSync(currentTarget.workspaceDir)) {
        await rm(currentTarget.workspaceDir, { recursive: true, force: true });
      }
    });

    let baselineSpec = `${OP_PACKAGE}@latest`;
    let baselineLabel = "npm@latest";
    if (baselineKind === "main") {
      const sha = await resolveMainCommitSha(repoRoot);
      const mainTarball = await resolveMainTarball(repoRoot, sha);
      cleanups.push(async () => {
        if (existsSync(mainTarball)) await rm(mainTarball, { force: true });
      });
      baselineSpec = mainTarball;
      baselineLabel = `main@${sha.slice(0, 12)}`;
    }

    const baselineTarget = await installTarget("baseline", baselineSpec);
    cleanups.push(async () => {
      if (existsSync(baselineTarget.workspaceDir)) {
        await rm(baselineTarget.workspaceDir, { recursive: true, force: true });
      }
    });

    logger.info(
      `\nInstalled targets:\n- current (${currentLabel}): ${currentTarget.packageVersion} (${currentTarget.packageDir})\n- baseline (${baselineLabel}): ${baselineTarget.packageVersion} (${baselineTarget.packageDir})`,
    );

    const currentModule = await importOpFactory(currentTarget.packageDir);
    const baselineModule = await importOpFactory(baselineTarget.packageDir);

    const currentRuntime = await runRuntimeBenchmarks(currentModule.Op);
    const baselineRuntime = await runRuntimeBenchmarks(baselineModule.Op);
    const currentSize = await measureBundleSize(currentTarget.packageDir);
    const baselineSize = await measureBundleSize(baselineTarget.packageDir);

    printRuntimeComparison(currentRuntime, baselineRuntime);
    printBundleComparison(currentSize, baselineSize);

    const report = buildBenchmarkReport({
      baselineKind,
      currentLabel,
      currentFingerprint,
      currentVersion: currentTarget.packageVersion,
      baselineLabel,
      baselineVersion: baselineTarget.packageVersion,
      currentRuntime,
      baselineRuntime,
      currentSize,
      baselineSize,
    });
    printOverheadSummary(report);
    if (reportPath !== undefined) {
      await writeJsonReport(reportPath, report);
      logger.info(`Wrote benchmark report: ${path.resolve(reportPath)}`);
    }
  } catch (error) {
    failure = error;
  }
  await runCleanup(cleanups);
  if (failure !== undefined) throw failure;
}

main().catch(async (error) => {
  logger.error(error);
  process.exitCode = 1;
});
