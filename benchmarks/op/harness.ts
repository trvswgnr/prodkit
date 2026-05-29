import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Bench } from "tinybench";
import { COMPOSE_STEPS, type OpRunResult, type ProfileScenarioOpFactory } from "./scenarios.ts";

export { COMPOSE_STEPS };
export type { OpRunResult, ProfileScenarioOpFactory };
export type ProfileOpFactory = ProfileScenarioOpFactory;

export const OP_PACKAGE = "@prodkit/op";
export const ENTRY_FALLBACK = "./dist/index.mjs";
export const BENCHMARK_ARTIFACTS_DIR = ".artifacts";

export const DEFAULT_BENCH_TIME_MS = 300;
export const DEFAULT_BENCH_WARMUP_TIME_MS = 150;
export const DEFAULT_BENCH_WARMUP_ITERATIONS = 5;

export type TinybenchRecord = {
  hz: number;
  latencyMs: number;
  latencyMinMs: number;
  latencyMaxMs: number;
  semMs: number;
  rme: number;
  sampleCount: number;
};

export type EnvironmentReport = {
  node: string;
  platform: NodeJS.Platform;
  arch: string;
};

export function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

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

function readRuntimeEntryFromExports(exportsField: unknown): string | undefined {
  if (typeof exportsField === "string") return exportsField;
  if (!isRecord(exportsField)) return undefined;

  const entry = exportsField["."];
  if (typeof entry === "string") return entry;
  if (!isRecord(entry)) return undefined;

  const runtimeEntry = entry.import;
  if (typeof runtimeEntry === "string") return runtimeEntry;

  const defaultEntry = entry.default;
  if (typeof defaultEntry === "string") return defaultEntry;
  return undefined;
}

export async function resolveBundleEntry(packageDir: string): Promise<string> {
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJsonRaw = readFileSync(packageJsonPath, "utf8");
  const packageJson: unknown = JSON.parse(packageJsonRaw);

  if (!isRecord(packageJson)) {
    throw new Error("Could not parse package.json.");
  }

  const exportEntry = readRuntimeEntryFromExports(packageJson.exports);
  const moduleEntry = typeof packageJson.module === "string" ? packageJson.module : undefined;
  const mainEntry = typeof packageJson.main === "string" ? packageJson.main : undefined;
  const candidate = exportEntry ?? moduleEntry ?? mainEntry ?? ENTRY_FALLBACK;
  return relativeSafePath(packageDir, candidate);
}

export async function readPackageVersion(packageDir: string): Promise<string> {
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJsonRaw = readFileSync(packageJsonPath, "utf8");
  const packageJson: unknown = JSON.parse(packageJsonRaw);
  if (!isRecord(packageJson)) {
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
  if (!isRecord(mod) || !mod.Op) {
    throw new Error(`Unable to import Op factory from ${modulePath}.`);
  }
  return { Op: mod.Op };
}

export function assertProfileOpFactory(input: unknown): ProfileScenarioOpFactory {
  if (!isRecord(input)) {
    throw new Error("Imported Op value is invalid.");
  }
  if (typeof input.of !== "function" || typeof input !== "function") {
    throw new Error("Imported Op is missing required methods (of).");
  }
  return input as ProfileScenarioOpFactory;
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

export function resolveReportPath(argv: readonly string[], defaultName: string): string {
  return parseReportPath(argv) ?? resolveBenchmarkArtifact(defaultName);
}

export async function ensureBenchmarkArtifactsDir(): Promise<string> {
  const absolutePath = path.resolve(BENCHMARK_ARTIFACTS_DIR);
  await mkdir(absolutePath, { recursive: true });
  return absolutePath;
}

export function parseStepsArg(argv: readonly string[]): number {
  const value = parseArgValue(argv, "--steps=");
  if (value === undefined) return COMPOSE_STEPS;
  return parsePositiveInt(value, "steps");
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
  options: {
    time?: number;
    warmupTime?: number;
    warmupIterations?: number;
  } = {},
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
