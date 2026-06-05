import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createLogger, readRepoRoot } from "../lib/utils.ts";
import {
  OP_PUBLIC_API_MANIFEST_REL,
  renderPublicApiManifest,
} from "./lib/op-public-api-snapshot.ts";

const logger = createLogger();

export function checkPublicApiManifest(repoRoot: string): void {
  const manifestPath = path.join(repoRoot, OP_PUBLIC_API_MANIFEST_REL);
  const current = renderPublicApiManifest(repoRoot);

  if (!existsSync(manifestPath)) {
    throw new Error(
      `Missing ${OP_PUBLIC_API_MANIFEST_REL}. Run: pnpm --filter @prodkit/tools run api:manifest:update`,
    );
  }

  const committed = readFileSync(manifestPath, "utf8");
  if (committed !== current) {
    throw new Error(
      `Public API manifest is out of date (${OP_PUBLIC_API_MANIFEST_REL}). Run: pnpm --filter @prodkit/tools run api:manifest:update`,
    );
  }
}

function main(): void {
  const write = process.argv.includes("--write");
  const repoRoot = readRepoRoot();
  const manifestPath = path.join(repoRoot, OP_PUBLIC_API_MANIFEST_REL);
  const current = renderPublicApiManifest(repoRoot);

  if (write) {
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, current, "utf8");
    logger.info(`updated ${OP_PUBLIC_API_MANIFEST_REL}`);
    return;
  }

  checkPublicApiManifest(repoRoot);
  logger.info("public API manifest check passed");
}

try {
  main();
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
