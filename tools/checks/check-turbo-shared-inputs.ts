import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createLogger } from "../lib/logger.ts";
import { readRepoRoot } from "../lib/repo-root.ts";

const logger = createLogger();

const TURBO_JSON = "turbo.json";

const SHARED_RUNTIME_INPUT = "$TURBO_ROOT$/packages/shared/runtime/**/*.ts";
const SHARED_TYPES_INPUT = "$TURBO_ROOT$/packages/shared/types/**/*.ts";
const SHARED_AMBIENT_TYPES_INPUT = "$TURBO_ROOT$/packages/shared/types/**/*.d.ts";
const SHARED_TSCONFIG_INPUT = "$TURBO_ROOT$/packages/shared/config/tsconfig.publishable.json";
const SHARED_VITEST_INPUT = "$TURBO_ROOT$/packages/shared/config/vitest.publishable.ts";
const SHARED_TSDOWN_INPUT = "$TURBO_ROOT$/packages/shared/config/tsdown.publishable.ts";
const SHARED_CONFIG_TS_INPUT = "$TURBO_ROOT$/packages/shared/config/**/*.ts";

const SHARED_PACKAGE_BUILD_INPUTS = [
  "runtime/**/*.ts",
  "types/**/*.ts",
  "types/**/*.d.ts",
  "config/**/*.ts",
  "config/**/*.json",
] as const;

const REQUIRED_SHARED_INPUTS_BY_TASK = {
  build: [
    SHARED_RUNTIME_INPUT,
    SHARED_TYPES_INPUT,
    SHARED_AMBIENT_TYPES_INPUT,
    SHARED_TSCONFIG_INPUT,
    SHARED_TSDOWN_INPUT,
  ],
  "@prodkit/shared#build": SHARED_PACKAGE_BUILD_INPUTS,
  test: [
    SHARED_RUNTIME_INPUT,
    SHARED_TYPES_INPUT,
    SHARED_AMBIENT_TYPES_INPUT,
    SHARED_TSCONFIG_INPUT,
    SHARED_VITEST_INPUT,
  ],
  "@prodkit/benchmarks#test": [SHARED_RUNTIME_INPUT],
  typecheck: [
    SHARED_RUNTIME_INPUT,
    SHARED_TYPES_INPUT,
    SHARED_AMBIENT_TYPES_INPUT,
    SHARED_TSCONFIG_INPUT,
  ],
  "@prodkit/benchmarks#typecheck": [SHARED_RUNTIME_INPUT],
  lint: [SHARED_RUNTIME_INPUT, SHARED_TYPES_INPUT, SHARED_AMBIENT_TYPES_INPUT],
  "fmt:check": [
    SHARED_RUNTIME_INPUT,
    SHARED_TYPES_INPUT,
    SHARED_AMBIENT_TYPES_INPUT,
    SHARED_CONFIG_TS_INPUT,
  ],
} as const;

type TurboTasks = Record<string, { inputs?: unknown }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTurboTasks(repoRoot: string): TurboTasks {
  const turboJsonPath = path.join(repoRoot, TURBO_JSON);
  const parsed: unknown = JSON.parse(readFileSync(turboJsonPath, "utf8"));

  if (!isRecord(parsed) || !isRecord(parsed.tasks)) {
    throw new Error(`${TURBO_JSON}: expected a top-level tasks object`);
  }

  const tasks: TurboTasks = {};
  for (const [taskName, taskConfig] of Object.entries(parsed.tasks)) {
    if (!isRecord(taskConfig)) {
      throw new Error(`${TURBO_JSON}: task ${taskName} must be an object`);
    }
    tasks[taskName] = taskConfig;
  }
  return tasks;
}

function assertTaskInputs(
  tasks: TurboTasks,
  taskName: string,
  requiredInputs: readonly string[],
): void {
  const task = tasks[taskName];
  if (!task) {
    throw new Error(`${TURBO_JSON}: missing task ${taskName}`);
  }

  if (!Array.isArray(task.inputs) || !task.inputs.every((input) => typeof input === "string")) {
    throw new Error(`${TURBO_JSON}: task ${taskName} must declare string inputs`);
  }

  const actualInputs = new Set(task.inputs);
  const missingInputs = requiredInputs.filter((input) => !actualInputs.has(input));
  if (missingInputs.length > 0) {
    throw new Error(
      `${TURBO_JSON}: task ${taskName} is missing shared cache input(s): ${missingInputs.join(
        ", ",
      )}`,
    );
  }
}

function checkTurboSharedInputs(repoRoot: string): void {
  const tasks = readTurboTasks(repoRoot);
  for (const [taskName, requiredInputs] of Object.entries(REQUIRED_SHARED_INPUTS_BY_TASK)) {
    assertTaskInputs(tasks, taskName, requiredInputs);
  }
}

function main(): void {
  checkTurboSharedInputs(readRepoRoot());
  logger.info("turbo shared input check passed");
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    main();
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
