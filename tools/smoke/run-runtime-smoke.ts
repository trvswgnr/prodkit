/**
 * Alternate-runtime smoke harness (Bun, Deno, edge, Node).
 *
 * IMPORTANT: Do not import `@prodkit/op` or `../lib/utils.ts` at module load. CI runs this job after
 * install only; the harness builds and packs `@prodkit/op` before executing it.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createLogger } from "../lib/logger.ts";
import { readRepoRoot } from "../lib/repo-root.ts";

type Runtime = "bun" | "deno" | "edge" | "node";

const REPO_ROOT = readRepoRoot();
const RUNTIME_SMOKE_STATE_DIR = path.join(REPO_ROOT, "var", "runtime-smoke");
const PNPM_RUNTIME_STORE_DIR = path.join(RUNTIME_SMOKE_STATE_DIR, "store");
const BETTER_RESULT_VERSION_ENV = "BETTER_RESULT_VERSION";
const DEFAULT_BETTER_RESULT_VERSION = "3.0.1";
const PACK_OUTPUT_PREVIEW = 4000;
const logger = createLogger(import.meta.url);

function commandEnv(): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(nextEnv)) {
    if (key.toLowerCase().startsWith("npm_config_")) delete nextEnv[key];
  }
  mkdirSync(PNPM_RUNTIME_STORE_DIR, { recursive: true });
  return nextEnv;
}

function run(command: string, args: readonly string[], cwd: string, capture = false) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: commandEnv(),
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (status, signal) => {
      if (status === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed in ${cwd} with ${signal ?? `exit ${String(status)}`}\n${stderr}`,
        ),
      );
    });
  });
}

function parsePackFilename(packOutput: string): string {
  try {
    const parsed: { filename?: unknown } = JSON.parse(packOutput.trim());
    if (typeof parsed.filename === "string" && parsed.filename.length > 0) {
      return parsed.filename;
    }
  } catch {
    // handled below
  }
  const preview =
    packOutput.length > PACK_OUTPUT_PREVIEW
      ? `${packOutput.slice(0, PACK_OUTPUT_PREVIEW)}...`
      : packOutput;
  throw new Error(`Unable to read tarball filename from pnpm pack --json:\n${preview}`);
}

async function createPackTarball(): Promise<string> {
  await run("pnpm", ["--filter", "@prodkit/op", "run", "build"], REPO_ROOT);
  const packOutput = await run(
    "pnpm",
    ["--filter", "@prodkit/op", "pack", "--json"],
    REPO_ROOT,
    true,
  );
  const filename = parsePackFilename(packOutput);
  const tarballPath = path.isAbsolute(filename) ? filename : path.resolve(REPO_ROOT, filename);
  const relative = path.relative(REPO_ROOT, tarballPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`pnpm pack filename resolved outside the repository root: ${tarballPath}`);
  }
  return tarballPath;
}

interface SmokeSourceOptions {
  betterResultVersion: string;
  diImport: string;
  hktImport: string;
  opImport: string;
  policyImport: string;
  resultImport: string;
}

function smokeSource(options: SmokeSourceOptions): string {
  const smokeContext = `better-result@${options.betterResultVersion}`;
  return `const SMOKE_CONTEXT = ${JSON.stringify(smokeContext)};

class AssertionError extends Error {
  name = "AssertionError";
}

function assert(condition, message) {
  if (!condition) throw new AssertionError(message);
}

async function verify(label, run) {
  try {
    return await run();
  } catch (cause) {
    const error = new Error(SMOKE_CONTEXT + ": " + label + " failed");
    error.cause = cause;
    throw error;
  }
}

async function runRuntimeSmoke() {
  const opModule = await verify("@prodkit/op import", () => import(${JSON.stringify(options.opImport)}));
  const policyModule = await verify("@prodkit/op/policy import", () => import(${JSON.stringify(options.policyImport)}));
  await verify("@prodkit/op/di import", () => import(${JSON.stringify(options.diImport)}));
  await verify("@prodkit/op/hkt import", () => import(${JSON.stringify(options.hktImport)}));
  const resultModule = await verify("better-result import", () => import(${JSON.stringify(options.resultImport)}));

  const { Op, TimeoutError } = opModule;
  const { Policy } = policyModule;
  const { TaggedError, UnhandledException } = resultModule;

  class TooSmallError extends TaggedError("TooSmallError") {}

  await verify("TimeoutError construction", () => {
    const timeoutError = new TimeoutError({ timeoutMs: 25 });
    assert(timeoutError._tag === "TimeoutError", "TimeoutError tag changed");
    assert(
      timeoutError.message === "Operation timed out after 25ms",
      "TimeoutError message changed",
    );
    assert(timeoutError.timeoutMs === 25, "TimeoutError value changed");
    assert(TimeoutError.is(timeoutError), "TimeoutError guard failed");
  });

  const divide = Op(function* (a, b) {
    if (b === 0) return yield* new TooSmallError();
    return a / b;
  });

  const program = Op(function* () {
    const quotient = yield* divide(18, 3);
    const doubled = yield* Op.of(quotient * 2);
    return doubled;
  });

  await verify("successful Op run", async () => {
    const result = await program.run();
    assert(result.isOk() && result.value === 12, "composition failed");
  });

  await verify("typed tagged-error failure", async () => {
    const divideError = await divide.run(1, 0);
    assert(divideError.isErr() && TooSmallError.is(divideError.error), "typed failure failed");
  });

  await verify("timeout policy", async () => {
    const timeoutResult = await Op.try(
      (signal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 50);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
          }, { once: true });
        }),
    )
      .with(Policy.timeout(1))
      .run();
    assert(timeoutResult.isErr() && TimeoutError.is(timeoutResult.error), "timeout failed");
  });

  await verify("unexpected exception wrapping", async () => {
    const unexpectedResult = await Op.try(() => {
      throw new Error("boom");
    }).run();
    assert(
      unexpectedResult.isErr() && UnhandledException.is(unexpectedResult.error),
      "unexpected exception wrapping failed",
    );
  });
}
`;
}

function readBetterResultVersion(): string {
  const version = process.env[BETTER_RESULT_VERSION_ENV]?.trim() || DEFAULT_BETTER_RESULT_VERSION;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${BETTER_RESULT_VERSION_ENV} must contain an exact semantic version`);
  }
  return version;
}

async function createRuntimeWorkspace(tarballPath: string, betterResultVersion: string) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "op-runtime-smoke-"));
  await writeFile(
    path.join(workspaceDir, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@prodkit/op": `file:${tarballPath}`,
          "better-result": betterResultVersion,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await run(
    "pnpm",
    ["install", "--ignore-scripts", `--store-dir=${PNPM_RUNTIME_STORE_DIR}`],
    workspaceDir,
  );

  const installedPackageJson: unknown = JSON.parse(
    await readFile(
      path.join(workspaceDir, "node_modules", "better-result", "package.json"),
      "utf8",
    ),
  );
  const installedVersion =
    typeof installedPackageJson === "object" && installedPackageJson !== null
      ? Reflect.get(installedPackageJson, "version")
      : undefined;
  if (installedVersion !== betterResultVersion) {
    throw new Error(
      `better-result@${betterResultVersion}: installed ${String(installedVersion)} instead`,
    );
  }
  return workspaceDir;
}

async function writeSmokeScript(workspaceDir: string, betterResultVersion: string): Promise<void> {
  await writeFile(
    path.join(workspaceDir, "runtime-smoke.mjs"),
    `${smokeSource({
      betterResultVersion,
      diImport: "@prodkit/op/di",
      hktImport: "@prodkit/op/hkt",
      opImport: "@prodkit/op",
      policyImport: "@prodkit/op/policy",
      resultImport: "better-result",
    })}\nawait runRuntimeSmoke();\n`,
    "utf8",
  );
}

async function smokeScriptedRuntime(
  workspaceDir: string,
  betterResultVersion: string,
  command: string,
  args: readonly string[],
): Promise<void> {
  await writeSmokeScript(workspaceDir, betterResultVersion);
  await run(command, args, workspaceDir);
}

async function smokeBun(workspaceDir: string, betterResultVersion: string) {
  await smokeScriptedRuntime(workspaceDir, betterResultVersion, "bun", ["./runtime-smoke.mjs"]);
}

async function smokeNode(workspaceDir: string, betterResultVersion: string) {
  await smokeScriptedRuntime(workspaceDir, betterResultVersion, "node", ["./runtime-smoke.mjs"]);
}

async function smokeDeno(workspaceDir: string, betterResultVersion: string) {
  await writeSmokeScript(workspaceDir, betterResultVersion);
  await writeFile(
    path.join(workspaceDir, "import-map.json"),
    `${JSON.stringify(
      {
        imports: {
          "@prodkit/op": "./node_modules/@prodkit/op/dist/index.mjs",
          "@prodkit/op/di": "./node_modules/@prodkit/op/dist/di/index.mjs",
          "@prodkit/op/hkt": "./node_modules/@prodkit/op/dist/hkt.mjs",
          "@prodkit/op/policy": "./node_modules/@prodkit/op/dist/policy/index.mjs",
          "better-result": "./node_modules/better-result/dist/index.mjs",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await run(
    "deno",
    ["run", "--quiet", "--import-map", "./import-map.json", "./runtime-smoke.mjs"],
    workspaceDir,
  );
}

async function copyDistMjsFiles(sourceDir: string, targetDir: string): Promise<string[]> {
  mkdirSync(targetDir, { recursive: true });
  const modulePaths: string[] = [];
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      modulePaths.push(...(await copyDistMjsFiles(sourcePath, targetPath)));
      continue;
    }
    if (!entry.name.endsWith(".mjs")) continue;
    const content = await readFile(sourcePath, "utf8");
    const rewritten = content.replaceAll(
      /(from\s*["'])better-result(["'])/g,
      "$1./better-result.mjs$2",
    );
    await writeFile(targetPath, rewritten, "utf8");
    modulePaths.push(targetPath);
  }
  return modulePaths;
}

async function smokeEdge(workspaceDir: string, betterResultVersion: string) {
  const edgeDir = path.join(workspaceDir, "edge");
  mkdirSync(edgeDir);

  const opDistDir = path.join(workspaceDir, "node_modules", "@prodkit", "op", "dist");
  const opEntryPath = path.join(opDistDir, "index.mjs");
  const resultEntryPath = path.join(
    workspaceDir,
    "node_modules",
    "better-result",
    "dist",
    "index.mjs",
  );
  if (!existsSync(opEntryPath)) throw new Error(`Missing packed @prodkit/op entry: ${opEntryPath}`);
  if (!existsSync(resultEntryPath))
    throw new Error(`Missing better-result entry: ${resultEntryPath}`);

  const opModulePaths = await copyDistMjsFiles(opDistDir, edgeDir);
  const resultModulePath = path.join(edgeDir, "better-result.mjs");
  const workerModulePath = path.join(edgeDir, "worker.mjs");
  await cp(resultEntryPath, resultModulePath);
  await writeFile(
    workerModulePath,
    `${smokeSource({
      betterResultVersion,
      diImport: "./di/index.mjs",
      hktImport: "./hkt.mjs",
      opImport: "./index.mjs",
      policyImport: "./policy/index.mjs",
      resultImport: "./better-result.mjs",
    })}

export default {
  async fetch() {
    await runRuntimeSmoke();
    return new Response("ok");
  },
};
`,
    "utf8",
  );

  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: [workerModulePath, ...opModulePaths, resultModulePath].map((modulePath) => ({
        type: "ESModule",
        path: modulePath,
      })),
      modulesRoot: edgeDir,
    }),
  );
  try {
    const response = await mf.dispatchFetch("https://runtime-smoke.test/");
    const body = await response.text();
    if (!response.ok || body !== "ok") {
      throw new Error(`Miniflare smoke failed with ${response.status}: ${body}`);
    }
  } finally {
    await mf.dispose();
  }
}

function parseRuntime(rawRuntime: string | undefined): Runtime[] {
  if (rawRuntime === undefined || rawRuntime === "all") return ["bun", "deno", "edge", "node"];
  if (
    rawRuntime === "bun" ||
    rawRuntime === "deno" ||
    rawRuntime === "edge" ||
    rawRuntime === "node"
  ) {
    return [rawRuntime];
  }
  throw new Error(`Unknown runtime smoke target: ${rawRuntime}`);
}

async function main() {
  const runtimes = parseRuntime(process.argv[2]);
  const betterResultVersion = readBetterResultVersion();
  logger.info(`testing packed @prodkit/op with better-result@${betterResultVersion}`);
  const tarballPath = await createPackTarball();
  try {
    for (const runtime of runtimes) {
      const workspaceDir = await createRuntimeWorkspace(tarballPath, betterResultVersion);
      try {
        switch (runtime) {
          case "bun":
            await smokeBun(workspaceDir, betterResultVersion);
            break;
          case "node":
            await smokeNode(workspaceDir, betterResultVersion);
            break;
          case "deno":
            await smokeDeno(workspaceDir, betterResultVersion);
            break;
          case "edge":
            await smokeEdge(workspaceDir, betterResultVersion);
            break;
        }
        logger.info(`${runtime} completed successfully with better-result@${betterResultVersion}`);
      } finally {
        await rm(workspaceDir, { recursive: true, force: true });
      }
    }
  } finally {
    await rm(tarballPath, { force: true });
  }
}

main().catch((error: unknown) => {
  logger.error(error);
  process.exit(1);
});
