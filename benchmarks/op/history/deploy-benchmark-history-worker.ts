import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_BENCHMARK_HISTORY_WORKER_NAME = "prodkit-benchmark-history";
export const DEFAULT_BENCHMARK_HISTORY_COMPATIBILITY_DATE = "2026-06-25";

const logger = console;

export type BenchmarkHistoryWorkerConfigInput = {
  name: string;
  main: string;
  compatibilityDate: string;
  kvNamespaceId: string;
  artifactBaseUrl?: string;
};

export type BenchmarkHistoryWorkerWranglerConfig = {
  $schema: string;
  name: string;
  main: string;
  compatibility_date: string;
  compatibility_flags: ["nodejs_compat"];
  workers_dev: true;
  kv_namespaces: [
    {
      binding: "PRODKIT_BENCHMARK_HISTORY";
      id: string;
    },
  ];
  vars?: {
    PRODKIT_BENCHMARK_ARTIFACT_BASE_URL: string;
  };
};

export type BenchmarkHistoryWorkerDeployArgs = BenchmarkHistoryWorkerConfigInput & {
  configPath: string;
  dryRun: boolean;
};

type BenchmarkHistoryWorkerDeployMode = "deploy" | "dry-run";

type BenchmarkHistoryWorkerWranglerInvocation = {
  configPath: string;
  cwd: string;
  mode: BenchmarkHistoryWorkerDeployMode;
};

type BenchmarkHistoryWorkerDeployOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  runWrangler?: (input: BenchmarkHistoryWorkerWranglerInvocation) => number;
};

function usage(): string {
  return [
    "usage: node ./op/history/deploy-benchmark-history-worker.ts [--dry-run] [--config=<path>]",
    "  [--name=<worker-name>] --kv-namespace-id=<cloudflare-kv-namespace-id>",
    "  [--artifact-base-url=<public-r2-base-url>] [--compatibility-date=YYYY-MM-DD]",
    "",
    "Environment fallbacks:",
    "  PRODKIT_BENCHMARK_HISTORY_WORKER_NAME",
    "  PRODKIT_BENCHMARK_HISTORY_KV_NAMESPACE_ID",
    "  PRODKIT_BENCHMARK_ARTIFACT_BASE_URL",
  ].join("\n");
}

function argValue(argv: readonly string[], prefix: string): string | undefined {
  return argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function requiredNonEmpty(value: string | undefined, message: string): string {
  if (value !== undefined && value.trim().length > 0) return value.trim();
  throw new Error(message);
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  return value.trim();
}

function normalizeBenchmarkHistoryWorkerDeployArgv(argv: readonly string[]): readonly string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

function defaultConfigPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".artifacts",
    "wrangler.json",
  );
}

export function createBenchmarkHistoryWorkerWranglerConfig(
  input: BenchmarkHistoryWorkerConfigInput,
): BenchmarkHistoryWorkerWranglerConfig {
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: input.name,
    main: input.main,
    compatibility_date: input.compatibilityDate,
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    kv_namespaces: [
      {
        binding: "PRODKIT_BENCHMARK_HISTORY",
        id: input.kvNamespaceId,
      },
    ],
    ...(input.artifactBaseUrl === undefined
      ? {}
      : {
          vars: {
            PRODKIT_BENCHMARK_ARTIFACT_BASE_URL: input.artifactBaseUrl,
          },
        }),
  };
}

export function parseBenchmarkHistoryWorkerDeployArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): BenchmarkHistoryWorkerDeployArgs {
  const normalizedArgv = normalizeBenchmarkHistoryWorkerDeployArgv(argv);
  if (normalizedArgv.includes("--help") || normalizedArgv.includes("-h")) {
    throw new Error(usage());
  }
  const configPath = path.resolve(argValue(normalizedArgv, "--config=") ?? defaultConfigPath());
  return {
    name:
      optionalNonEmpty(argValue(normalizedArgv, "--name=")) ??
      optionalNonEmpty(env.PRODKIT_BENCHMARK_HISTORY_WORKER_NAME) ??
      DEFAULT_BENCHMARK_HISTORY_WORKER_NAME,
    main: "../history/benchmark-history-api.ts",
    compatibilityDate:
      optionalNonEmpty(argValue(normalizedArgv, "--compatibility-date=")) ??
      DEFAULT_BENCHMARK_HISTORY_COMPATIBILITY_DATE,
    kvNamespaceId: requiredNonEmpty(
      argValue(normalizedArgv, "--kv-namespace-id=") ??
        env.PRODKIT_BENCHMARK_HISTORY_KV_NAMESPACE_ID,
      "PRODKIT_BENCHMARK_HISTORY_KV_NAMESPACE_ID or --kv-namespace-id is required.",
    ),
    artifactBaseUrl: optionalNonEmpty(
      argValue(normalizedArgv, "--artifact-base-url=") ?? env.PRODKIT_BENCHMARK_ARTIFACT_BASE_URL,
    ),
    configPath,
    dryRun: normalizedArgv.includes("--dry-run"),
  };
}

async function writeWranglerConfig(args: BenchmarkHistoryWorkerDeployArgs): Promise<void> {
  await mkdir(path.dirname(args.configPath), { recursive: true });
  const config = createBenchmarkHistoryWorkerWranglerConfig(args);
  await writeFile(args.configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function runWrangler(input: BenchmarkHistoryWorkerWranglerInvocation): number {
  const argv = ["deploy", "--config", input.configPath];
  if (input.mode === "dry-run") argv.push("--dry-run");
  const result = spawnSync("wrangler", argv, {
    cwd: input.cwd,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export async function deployBenchmarkHistoryWorker(
  argv: readonly string[],
  options: BenchmarkHistoryWorkerDeployOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const args = parseBenchmarkHistoryWorkerDeployArgs(argv, options.env);
  await writeWranglerConfig(args);
  logger.info(`Wrote benchmark history Worker config to ${args.configPath}`);
  const status = (options.runWrangler ?? runWrangler)({
    configPath: args.configPath,
    cwd,
    mode: args.dryRun ? "dry-run" : "deploy",
  });
  if (args.dryRun && status === 0) {
    logger.info("Dry run only. Wrangler validated the Worker bundle without deploying.");
  }
  return status;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deployBenchmarkHistoryWorker(process.argv.slice(2))
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error: unknown) => {
      logger.error(error);
      process.exitCode = 1;
    });
}
