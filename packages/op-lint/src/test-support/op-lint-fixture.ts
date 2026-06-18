import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type TsConfigOptions = {
  allowJs?: boolean;
  include?: readonly string[];
};

export type TempOpLintProject = {
  betterResultRoot: string;
  cleanup(): void;
  distEntry: string;
  eslintBin: string;
  opPackageRoot: string;
  oxlintBin: string;
  packageRoot: string;
  repoRoot: string;
  tempDir: string;
  writeFile(relativePath: string, source: string): string;
  writeJson(relativePath: string, value: unknown): string;
};

export function setupTempOpLintProject(prefix = "prodkit-op-lint-"): TempOpLintProject {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const repoRoot = resolve(packageRoot, "../..");
  const tempDir = mkdtempSync(resolve(tmpdir(), prefix));
  const opPackageRoot = resolve(packageRoot, "../op");
  const betterResultRoot = resolve(opPackageRoot, "node_modules/better-result");
  const writeProjectFile = (relativePath: string, source: string) => {
    const filePath = resolve(tempDir, relativePath);
    writeFileSync(filePath, source, "utf8");
    return filePath;
  };

  mkdirSync(resolve(tempDir, "node_modules/@prodkit"), { recursive: true });
  symlinkSync(opPackageRoot, resolve(tempDir, "node_modules/@prodkit/op"), "dir");
  symlinkSync(betterResultRoot, resolve(tempDir, "node_modules/better-result"), "dir");

  return {
    betterResultRoot,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
    distEntry: resolve(packageRoot, "dist/index.mjs"),
    eslintBin: resolve(packageRoot, "node_modules/eslint/bin/eslint.js"),
    opPackageRoot,
    oxlintBin: resolve(repoRoot, "node_modules/oxlint/bin/oxlint"),
    packageRoot,
    repoRoot,
    tempDir,
    writeFile: writeProjectFile,
    writeJson(relativePath, value) {
      return writeProjectFile(relativePath, `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

export function setupTempDetectorProject(source: string): TempOpLintProject & { filePath: string } {
  const project = setupTempOpLintProject("op-lint-detector-");
  writeDefaultTsConfig(project);

  return {
    ...project,
    filePath: project.writeFile("fixture.ts", source),
  };
}

export function writeDefaultTsConfig(
  project: TempOpLintProject,
  options: TsConfigOptions = {},
): string {
  return project.writeJson("tsconfig.json", {
    compilerOptions: {
      ...(options.allowJs === true ? { allowJs: true } : {}),
      module: "NodeNext",
      moduleResolution: "NodeNext",
      skipLibCheck: true,
      strict: true,
      target: "ES2022",
    },
    include: options.include ?? ["*.ts"],
  });
}
