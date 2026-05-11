import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import process from "node:process";

const MONITORED_BINS = ["oxlint", "oxfmt"] as const;

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type MissingDep = {
  packageName: string;
  packagePath: string;
  bin: (typeof MONITORED_BINS)[number];
  scripts: string[];
};

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function parseWorkspaceGlobs(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const globs: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    globs.push(stripQuotes(trimmed.slice(1).trim()));
  }

  return globs.filter((glob) => glob.endsWith("/*"));
}

async function getWorkspacePackageJsonPaths(repoRoot: string): Promise<string[]> {
  const workspaceYamlPath = path.join(repoRoot, "pnpm-workspace.yaml");
  const workspaceYaml = await fs.readFile(workspaceYamlPath, "utf8");
  const globs = parseWorkspaceGlobs(workspaceYaml);
  const packageJsonPaths: string[] = [];

  for (const glob of globs) {
    const baseDirectory = glob.slice(0, -2);
    const absoluteBaseDirectory = path.join(repoRoot, baseDirectory);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(absoluteBaseDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageJsonPath = path.join(absoluteBaseDirectory, entry.name, "package.json");
      try {
        await fs.access(packageJsonPath);
        packageJsonPaths.push(packageJsonPath);
      } catch {
        // Ignore directories that are not workspace packages.
      }
    }
  }

  return packageJsonPaths;
}

function scriptUsesBin(script: string, bin: string): boolean {
  // Match whole-word command usage, including chained commands.
  const pattern = new RegExp(`(^|[\\s;&|()])${bin}(?=\\s|$)`);
  return pattern.test(script);
}

function findMissingDeps(packageJson: PackageJson, packagePath: string): MissingDep[] {
  const packageName = packageJson.name ?? packagePath;
  const scripts = packageJson.scripts ?? {};
  const dependencies = packageJson.dependencies ?? {};
  const devDependencies = packageJson.devDependencies ?? {};
  const declaredDeps = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)]);

  const missing: MissingDep[] = [];

  for (const bin of MONITORED_BINS) {
    const scriptsUsingBin = Object.entries(scripts)
      .filter(([, script]) => scriptUsesBin(script, bin))
      .map(([scriptName]) => scriptName);

    if (scriptsUsingBin.length === 0) continue;
    if (declaredDeps.has(bin)) continue;

    missing.push({
      packageName,
      packagePath,
      bin,
      scripts: scriptsUsingBin,
    });
  }

  return missing;
}

async function main() {
  const repoRoot = execFileSync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const packageJsonPaths = await getWorkspacePackageJsonPaths(repoRoot);
  const missingDeps: MissingDep[] = [];

  for (const packageJsonPath of packageJsonPaths) {
    const packageJsonRaw = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw) as PackageJson;
    missingDeps.push(...findMissingDeps(packageJson, path.relative(repoRoot, packageJsonPath)));
  }

  if (missingDeps.length === 0) {
    console.info("workspace tool dependency check passed");
    process.exit(0);
  }

  console.error("workspace tool dependency check failed");
  for (const missing of missingDeps) {
    console.error(
      `- ${missing.packageName} (${missing.packagePath}) uses "${missing.bin}" in scripts [${missing.scripts.join(
        ", ",
      )}] but does not declare it in dependencies/devDependencies`,
    );
  }
  process.exit(1);
}

main().catch((error) => {
  console.error("workspace tool dependency check crashed", error);
  process.exit(1);
});
