import process from "node:process";
import { createLogger, readRepoRoot } from "../lib/utils.ts";
import { checkPublicDocs } from "./lib/check-public-docs.ts";

const logger = createLogger();

function main(): void {
  const issues = checkPublicDocs(readRepoRoot());
  if (issues.length === 0) {
    logger.info("public docs links and repo references are consistent");
    return;
  }
  for (const issue of issues) {
    logger.error(`${issue.doc}: ${issue.message} (${issue.href})`);
  }
  process.exit(1);
}

main();
