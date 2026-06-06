/**
 * Sync git repo-root lookup for maintainer scripts.
 *
 * IMPORTANT: Do not import `@prodkit/op` in this file. Runtime smoke CI runs install-only
 * (`ignoreScripts: true`), so this module must load before `packages/op/dist/` exists.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

let cachedRepoRoot: string | undefined;

export class RepoRootNotFoundError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Repository root does not exist: ${path}`);
    this.name = "RepoRootNotFoundError";
    this.path = path;
  }
}

export function readRepoRoot(): string {
  if (cachedRepoRoot) return cachedRepoRoot;
  const output = execFileSync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!output) {
    throw new Error("Expected to get the repo root from git, but got an empty output");
  }
  if (!existsSync(output)) {
    throw new RepoRootNotFoundError(output);
  }
  cachedRepoRoot = output;
  return output;
}
