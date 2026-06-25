import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isRecordLike } from "@prodkit/shared/runtime";
import { Bench } from "tinybench";
import { COMPOSE_STEPS, type BenchOp, type RunResult } from "./scenarios.ts";

export { COMPOSE_STEPS };
export type { BenchOp, RunResult };

export const OP_PACKAGE = "@prodkit/op";
export const ENTRY_FALLBACK = "./dist/index.mjs";
export const BENCHMARK_ARTIFACTS_DIR = "op/.artifacts";
export const BENCHMARK_PROFILE_DIR = ".profiles/op";

export const DEFAULT_BENCH_TIME_MS = 300;
export const DEFAULT_BENCH_WARMUP_TIME_MS = 150;
export const DEFAULT_BENCH_WARMUP_ITERATIONS = 5;
export const DEFAULT_BENCH_REPEATS = 1;

export type TinybenchRecord = {
  hz: number;
  latencyMs: number;
  latencyMinMs: number;
  latencyMaxMs: number;
  semMs: number;
  rme: number;
  sampleCount: number;
};

export type BenchRunOptions = {
  time?: number;
  warmupTime?: number;
  warmupIterations?: number;
  repeats?: number;
};

export type ResolvedBenchRunOptions = {
  time: number;
  warmupTime: number;
  warmupIterations: number;
  repeats: number;
};

export type RepeatedTinybenchRecord = TinybenchRecord & {
  repeats?: TinybenchRecord[];
};

export type EnvironmentReport = {
  node: string;
  platform: NodeJS.Platform;
  arch: string;
};

function readPackageJsonIfPresent(dir: string): unknown {
  const packageJsonPath = path.join(dir, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return undefined;
  }
}

function readOwnObjectField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  if (!Object.hasOwn(value, key)) return undefined;
  return Reflect.get(value, key);
}

function readPackageNameIfPresent(dir: string): string | undefined {
  const parsed = readPackageJsonIfPresent(dir);
  const name = readOwnObjectField(parsed, "name");
  return typeof name === "string" ? name : undefined;
}

export function getRepoRoot(): string {
  let currentDir = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    if (existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const name = readPackageNameIfPresent(currentDir);
    if (name === "@prodkit/monorepo" || name === OP_PACKAGE) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Unable to locate repo root");
    }
    currentDir = parentDir;
  }
}

export function resolveOpPackageDir(repoRoot: string, override?: string): string {
  if (override !== undefined) {
    return path.resolve(override);
  }
  const workspacePackageDir = path.join(repoRoot, "packages", "op");
  if (existsSync(path.join(workspacePackageDir, "package.json"))) return workspacePackageDir;
  if (readPackageNameIfPresent(repoRoot) === OP_PACKAGE) return repoRoot;
  throw new Error(`Unable to locate ${OP_PACKAGE} package directory from ${repoRoot}`);
}

function relativeSafePath(pkgRoot: string, candidate: string): string {
  const absolute = path.resolve(pkgRoot, candidate);
  const relative = path.relative(pkgRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Resolved entry path escaped package root: ${candidate}`);
  }
  return absolute;
}

function readRuntimeEntryFromExportTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (!isRecordLike(entry)) return undefined;

  const runtimeEntry = entry.import;
  if (typeof runtimeEntry === "string") return runtimeEntry;

  const defaultEntry = entry.default;
  if (typeof defaultEntry === "string") return defaultEntry;
  return undefined;
}

function readRuntimeEntryFromExports(exportsField: unknown, subpath: string): string | undefined {
  if (subpath === "." && typeof exportsField === "string") return exportsField;
  if (!isRecordLike(exportsField)) return undefined;
  return readRuntimeEntryFromExportTarget(exportsField[subpath]);
}

export async function resolveBundleEntry(
  packageDir: string,
  subpath: string = ".",
): Promise<string> {
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJsonRaw = readFileSync(packageJsonPath, "utf8");
  const packageJson: unknown = JSON.parse(packageJsonRaw);

  if (!isRecordLike(packageJson)) {
    throw new Error("Could not parse package.json.");
  }

  const exportEntry = readRuntimeEntryFromExports(packageJson.exports, subpath);
  const moduleEntry =
    subpath === "." && typeof packageJson.module === "string" ? packageJson.module : undefined;
  const mainEntry =
    subpath === "." && typeof packageJson.main === "string" ? packageJson.main : undefined;
  const candidate =
    exportEntry ?? moduleEntry ?? mainEntry ?? (subpath === "." ? ENTRY_FALLBACK : undefined);
  if (candidate === undefined) {
    throw new Error(`Unable to resolve ${OP_PACKAGE} export ${subpath} from ${packageJsonPath}.`);
  }
  return relativeSafePath(packageDir, candidate);
}

export async function readPackageVersion(packageDir: string): Promise<string> {
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJsonRaw = readFileSync(packageJsonPath, "utf8");
  const packageJson: unknown = JSON.parse(packageJsonRaw);
  if (!isRecordLike(packageJson)) {
    throw new Error("Could not parse package.json.");
  }
  const version = packageJson.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("Could not parse package.json version.");
  }
  return version;
}

export async function importOpModule(packageDir: string): Promise<{ Op: unknown }> {
  const modulePath = await resolveBundleEntry(packageDir);
  if (!existsSync(modulePath)) {
    throw new Error(
      `Resolved runtime entry does not exist: ${modulePath}. Run pnpm --filter @prodkit/op run build first.`,
    );
  }
  const mod: unknown = await import(pathToFileURL(modulePath).href);
  if (!isRecordLike(mod) || !mod.Op) {
    throw new Error(`Unable to import Op from ${modulePath}.`);
  }
  return { Op: mod.Op };
}

export async function importOpPolicyModule(packageDir: string): Promise<{ Policy: unknown }> {
  const modulePath = await resolveBundleEntry(packageDir, "./policy");
  if (!existsSync(modulePath)) {
    throw new Error(
      `Resolved policy entry does not exist: ${modulePath}. Run pnpm --filter @prodkit/op run build first.`,
    );
  }
  const mod: unknown = await import(pathToFileURL(modulePath).href);
  if (!isRecordLike(mod) || !mod.Policy) {
    throw new Error(`Unable to import Policy from ${modulePath}.`);
  }
  return { Policy: mod.Policy };
}

export function asBenchOp(input: unknown): BenchOp {
  if (!isRecordLike(input)) {
    throw new Error("Imported Op value is invalid.");
  }
  if (typeof input.of !== "function" || typeof input !== "function") {
    throw new Error("Imported Op is missing required methods (of).");
  }
  return input;
}

export function parseArgValue(argv: readonly string[], prefix: string): string | undefined {
  const arg = argv.find((item) => item.startsWith(prefix));
  if (!arg) return undefined;
  const value = arg.slice(prefix.length);
  if (value.length === 0) {
    throw new Error(`Invalid ${prefix} value. Expected a non-empty value.`);
  }
  return value;
}

export function parsePositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label} "${value}". Expected a positive integer.`);
  }
  return parsed;
}

export function parseReportPath(argv: readonly string[]): string | undefined {
  const value = parseArgValue(argv, "--report=");
  if (value === undefined) return undefined;
  if (value.length === 0) {
    throw new Error(`Invalid report path "". Expected a non-empty path.`);
  }
  return value;
}

export function resolveBenchmarkArtifact(name: string): string {
  return path.join(BENCHMARK_ARTIFACTS_DIR, name);
}

export function resolveProfileArtifact(name: string): string {
  return path.join(BENCHMARK_PROFILE_DIR, name);
}

export function resolveReportPath(argv: readonly string[], defaultName: string): string {
  return parseReportPath(argv) ?? resolveBenchmarkArtifact(defaultName);
}

export async function ensureBenchmarkArtifactsDir(): Promise<string> {
  const absolutePath = path.resolve(BENCHMARK_ARTIFACTS_DIR);
  await mkdir(absolutePath, { recursive: true });
  return absolutePath;
}

export async function ensureBenchmarkProfileDir(): Promise<string> {
  const absolutePath = path.resolve(BENCHMARK_PROFILE_DIR);
  await mkdir(absolutePath, { recursive: true });
  return absolutePath;
}

export function parseStepsArg(argv: readonly string[]): number {
  const value = parseArgValue(argv, "--steps=");
  if (value === undefined) return COMPOSE_STEPS;
  return parsePositiveInt(value, "steps");
}

export function parseBenchRunOptions(argv: readonly string[]): BenchRunOptions {
  const time = parseArgValue(argv, "--time=");
  const warmupTime = parseArgValue(argv, "--warmup-time=");
  const warmupIterations = parseArgValue(argv, "--warmup-iterations=");
  const repeats = parseArgValue(argv, "--repeats=");

  return {
    time: time === undefined ? undefined : parsePositiveInt(time, "time"),
    warmupTime: warmupTime === undefined ? undefined : parsePositiveInt(warmupTime, "warmup time"),
    warmupIterations:
      warmupIterations === undefined
        ? undefined
        : parsePositiveInt(warmupIterations, "warmup iterations"),
    repeats: repeats === undefined ? undefined : parsePositiveInt(repeats, "repeats"),
  };
}

export function benchRunOptionSummary(options: BenchRunOptions): string {
  const resolved = resolveBenchRunOptions(options);
  return `time=${resolved.time}ms warmupTime=${resolved.warmupTime}ms warmupIterations=${resolved.warmupIterations} repeats=${resolved.repeats}`;
}

export function resolveBenchRunOptions(options: BenchRunOptions): ResolvedBenchRunOptions {
  return {
    time: options.time ?? DEFAULT_BENCH_TIME_MS,
    warmupTime: options.warmupTime ?? DEFAULT_BENCH_WARMUP_TIME_MS,
    warmupIterations: options.warmupIterations ?? DEFAULT_BENCH_WARMUP_ITERATIONS,
    repeats: options.repeats ?? DEFAULT_BENCH_REPEATS,
  };
}

export function formatNumber(value: number): string {
  return Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function formatRatio(value: number): string {
  return `${value.toFixed(2)}x`;
}

export function readEnvironmentReport(): EnvironmentReport {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

export async function runTinybenchVariant(
  name: string,
  fn: () => Promise<unknown> | unknown,
  options: BenchRunOptions = {},
): Promise<TinybenchRecord> {
  const bench = new Bench({
    name,
    time: options.time ?? DEFAULT_BENCH_TIME_MS,
    warmupTime: options.warmupTime ?? DEFAULT_BENCH_WARMUP_TIME_MS,
    warmupIterations: options.warmupIterations ?? DEFAULT_BENCH_WARMUP_ITERATIONS,
  });
  bench.add(name, fn);
  await bench.run();

  const task = bench.tasks[0];
  const result = task?.result;
  const latency = result?.latency;
  const throughputMean = result?.throughput?.mean ?? result?.hz ?? 0;
  const latencyMean = latency?.mean ?? result?.mean ?? 0;

  return {
    hz: throughputMean,
    latencyMs: latencyMean,
    latencyMinMs: latency?.min ?? latencyMean,
    latencyMaxMs: latency?.max ?? latencyMean,
    semMs: latency?.sem ?? 0,
    rme: latency?.rme ?? 0,
    sampleCount: latency?.samples.length ?? 0,
  };
}

export async function runTinybenchRepeatedVariant(
  name: string,
  fn: () => Promise<unknown> | unknown,
  options: BenchRunOptions = {},
): Promise<RepeatedTinybenchRecord> {
  const repeats = options.repeats ?? DEFAULT_BENCH_REPEATS;
  if (repeats === 1) {
    return runTinybenchVariant(name, fn, options);
  }

  const records: TinybenchRecord[] = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    records.push(await runTinybenchVariant(name, fn, options));
  }

  const sorted = [...records].sort((left, right) => left.hz - right.hz);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median === undefined) {
    throw new Error(`No Tinybench records captured for ${name}.`);
  }
  return {
    ...median,
    repeats: records,
  };
}

export async function writeJsonReport(reportPath: string, report: unknown): Promise<void> {
  const absolutePath = path.resolve(reportPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(report, null, 2) + "\n", "utf8");
}

export function findNewestProfileArtifact(cwd: string, prefix: "CPU" | "Heap"): string | undefined {
  const suffix = prefix === "CPU" ? ".cpuprofile" : ".heapprofile";
  const candidates = readdirSync(cwd)
    .filter((name) => name.startsWith(`${prefix}.`) && name.endsWith(suffix))
    .map((name) => {
      const absolutePath = path.join(cwd, name);
      return { absolutePath, mtimeMs: statSync(absolutePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0]?.absolutePath;
}
