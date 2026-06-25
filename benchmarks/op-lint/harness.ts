import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isRecordLike } from "@prodkit/shared/runtime";
import { Linter } from "eslint";
import opLintPlugin from "@prodkit/op-lint";

export const OP_LINT_PROFILE_DIR = ".profiles/op-lint";
export const OP_LINT_RULE_ID = "prodkit-op/require-yield-star";

export type OpLintBenchmarkFile = {
  filePath: string;
  minimumDiagnostics: number;
  source: string;
};

export type OpLintBenchmarkProject = {
  cleanup(): void;
  distEntry: string;
  files: readonly OpLintBenchmarkFile[];
  linter: Linter;
  oxlintBin: string;
  tempDir: string;
};

type FixtureSourceOptions = {
  programs: number;
  typedExpressions: boolean;
};

type ProjectOptions = FixtureSourceOptions & {
  fileCount?: number;
  includeFixturesInTsConfig: boolean;
  prefix: string;
  writeOxlintConfig?: boolean;
};

type ParsedOxlintOutput = {
  diagnostics?: unknown;
};

const benchmarkDir = path.dirname(fileURLToPath(import.meta.url));
const benchmarksRoot = path.resolve(benchmarkDir, "..");
const repoRoot = path.resolve(benchmarksRoot, "..");

const eslintConfig: Linter.Config = {
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  plugins: {
    "prodkit-op": opLintPlugin,
  },
  rules: {
    [OP_LINT_RULE_ID]: "error",
  },
};

export function resolveOpLintProfileArtifact(name: string): string {
  return path.join(OP_LINT_PROFILE_DIR, name);
}

export async function ensureOpLintProfileDir(): Promise<string> {
  const absolutePath = path.resolve(OP_LINT_PROFILE_DIR);
  await mkdir(absolutePath, { recursive: true });
  return absolutePath;
}

export function setupDirectBuilderProject(programs = 24): OpLintBenchmarkProject {
  return setupBenchmarkProject({
    includeFixturesInTsConfig: true,
    prefix: "op-lint-direct-",
    programs,
    typedExpressions: false,
  });
}

export function setupTypeAwareWarmProject(programs = 16): OpLintBenchmarkProject {
  const project = setupBenchmarkProject({
    includeFixturesInTsConfig: true,
    prefix: "op-lint-warm-",
    programs,
    typedExpressions: true,
  });
  runEslint(project, project.files[0]);
  return project;
}

export function setupTypeAwareColdProject(fileCount = 48, programs = 5): OpLintBenchmarkProject {
  return setupBenchmarkProject({
    fileCount,
    includeFixturesInTsConfig: false,
    prefix: "op-lint-cold-",
    programs,
    typedExpressions: true,
  });
}

export function setupOxlintCliProject(fileCount = 4, programs = 5): OpLintBenchmarkProject {
  return setupBenchmarkProject({
    fileCount,
    includeFixturesInTsConfig: true,
    prefix: "op-lint-cli-",
    programs,
    typedExpressions: true,
    writeOxlintConfig: true,
  });
}

export function runEslint(
  project: OpLintBenchmarkProject,
  file: OpLintBenchmarkFile | undefined,
): number {
  if (file === undefined) {
    throw new Error("No op-lint benchmark file was selected.");
  }

  const messages = project.linter.verify(file.source, eslintConfig, { filename: file.filePath });
  const diagnosticCount = countRuleMessages(messages);
  if (diagnosticCount < file.minimumDiagnostics) {
    throw new Error(
      `Expected at least ${file.minimumDiagnostics} ${OP_LINT_RULE_ID} diagnostics, got ${diagnosticCount}: ${formatLintMessages(messages)}`,
    );
  }

  return diagnosticCount;
}

export function runOxlintCli(project: OpLintBenchmarkProject): number {
  if (!existsSync(project.distEntry)) {
    throw new Error(
      `Missing @prodkit/op-lint build at ${project.distEntry}. Run pnpm --filter @prodkit/op-lint run build first.`,
    );
  }

  const fileNames = project.files.map((file) => path.basename(file.filePath));
  const result = spawnSync(
    process.execPath,
    [project.oxlintBin, "--config", ".oxlintrc.json", "--format", "json", ...fileNames],
    {
      cwd: project.tempDir,
      encoding: "utf8",
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 1) {
    throw new Error(`Expected Oxlint to report ${OP_LINT_RULE_ID} diagnostics: ${output}`);
  }

  const diagnosticCount = countOxlintRuleDiagnostics(result.stdout);
  const minimumDiagnostics = project.files.reduce(
    (total, file) => total + file.minimumDiagnostics,
    0,
  );
  if (diagnosticCount < minimumDiagnostics) {
    throw new Error(
      `Expected at least ${minimumDiagnostics} ${OP_LINT_RULE_ID} diagnostics from Oxlint, got ${diagnosticCount}: ${output}`,
    );
  }

  return diagnosticCount;
}

function setupBenchmarkProject(options: ProjectOptions): OpLintBenchmarkProject {
  const tempDir = mkdtempSync(path.resolve(tmpdir(), options.prefix));
  const distEntry = path.resolve(repoRoot, "packages/op-lint/dist/index.mjs");
  const opPackageRoot = path.resolve(repoRoot, "packages/op");
  const betterResultRoot = path.resolve(opPackageRoot, "node_modules/better-result");
  const oxlintBin = path.resolve(repoRoot, "node_modules/oxlint/bin/oxlint");

  mkdirSync(path.resolve(tempDir, "node_modules/@prodkit"), { recursive: true });
  symlinkSync(opPackageRoot, path.resolve(tempDir, "node_modules/@prodkit/op"), "dir");
  symlinkSync(betterResultRoot, path.resolve(tempDir, "node_modules/better-result"), "dir");

  writeFileSync(path.resolve(tempDir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  writeFileSync(
    path.resolve(tempDir, "ops.js"),
    ['import { Op } from "@prodkit/op";', 'export const importedOperation = Op.of("ok");', ""].join(
      "\n",
    ),
  );
  writeTsConfig(tempDir, options.includeFixturesInTsConfig);
  if (options.writeOxlintConfig === true) writeOxlintConfig(tempDir, distEntry);

  const fileCount = options.fileCount ?? 1;
  const files = Array.from({ length: fileCount }, (_, index) =>
    writeFixtureFile(tempDir, `fixture-${index}.js`, {
      programs: options.programs,
      typedExpressions: options.typedExpressions,
    }),
  );

  return {
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
    distEntry,
    files,
    linter: new Linter({ cwd: tempDir }),
    oxlintBin,
    tempDir,
  };
}

function writeTsConfig(tempDir: string, includeFixturesInTsConfig: boolean): void {
  const include = includeFixturesInTsConfig ? ["*.js"] : ["ops.js"];
  writeFileSync(
    path.resolve(tempDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          allowJs: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
        },
        include,
      },
      null,
      2,
    )}\n`,
  );
}

function writeOxlintConfig(tempDir: string, distEntry: string): void {
  writeFileSync(
    path.resolve(tempDir, "plugin.mjs"),
    `export { default } from ${JSON.stringify(pathToFileURL(distEntry).href)};\n`,
  );
  writeFileSync(
    path.resolve(tempDir, ".oxlintrc.json"),
    `${JSON.stringify(
      {
        jsPlugins: [{ name: "prodkit-op", specifier: "./plugin.mjs" }],
        rules: {
          [OP_LINT_RULE_ID]: "error",
        },
      },
      null,
      2,
    )}\n`,
  );
}

function writeFixtureFile(
  tempDir: string,
  relativePath: string,
  options: FixtureSourceOptions,
): OpLintBenchmarkFile {
  const source = fixtureSource(options);
  const filePath = path.resolve(tempDir, relativePath);
  writeFileSync(filePath, source, "utf8");

  return {
    filePath,
    minimumDiagnostics: options.programs * (options.typedExpressions ? 6 : 2),
    source,
  };
}

function fixtureSource(options: FixtureSourceOptions): string {
  const lines = ['import { Op, Op as Operation } from "@prodkit/op";'];

  if (options.typedExpressions) {
    lines.push(
      'import { importedOperation } from "./ops.js";',
      "",
      "const direct = Op.of(1);",
      "const alias = direct;",
      "const Console = {",
      "  info: () => Op.of(undefined),",
      "};",
    );
  }

  lines.push("");
  for (let index = 0; index < options.programs; index += 1) {
    lines.push(`export const program${index} = Op(function* () {`);
    lines.push(`  Op.of(${index});`);
    lines.push(`  Operation.of(${index});`);
    if (options.typedExpressions) {
      lines.push("  direct;");
      lines.push("  alias;");
      lines.push("  importedOperation;");
      lines.push("  Console.info();");
      lines.push("  yield direct;");
    }
    lines.push(`  return yield* Op.of(${index});`);
    lines.push("});", "");
  }

  return lines.join("\n");
}

function countRuleMessages(messages: readonly Linter.LintMessage[]): number {
  return messages.filter((message) => message.ruleId === OP_LINT_RULE_ID).length;
}

function formatLintMessages(messages: readonly Linter.LintMessage[]): string {
  return JSON.stringify(
    messages.map((message) => ({
      line: message.line,
      message: message.message,
      ruleId: message.ruleId,
    })),
  );
}

function countOxlintRuleDiagnostics(stdout: string): number {
  const parsed: unknown = JSON.parse(stdout);
  if (!isParsedOxlintOutput(parsed)) return 0;
  if (!Array.isArray(parsed.diagnostics)) return 0;

  return parsed.diagnostics.filter((diagnostic) => {
    if (!isRecordLike(diagnostic)) return false;
    return diagnostic["code"] === "prodkit-op(require-yield-star)";
  }).length;
}

function isParsedOxlintOutput(value: unknown): value is ParsedOxlintOutput {
  return isRecordLike(value);
}

export function readPackageVersion(packageDir: string): string {
  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJsonRaw = readFileSync(packageJsonPath, "utf8");
  const parsed: unknown = JSON.parse(packageJsonRaw);
  if (!isRecordLike(parsed) || typeof parsed["version"] !== "string") {
    throw new Error(`Could not read package version from ${packageJsonPath}.`);
  }
  return parsed["version"];
}

export function resolveOpLintPackageDir(): string {
  return path.resolve(repoRoot, "packages/op-lint");
}
