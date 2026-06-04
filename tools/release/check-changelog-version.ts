import process from "node:process";
import { Op } from "@prodkit/op";
import { TaggedError } from "better-result";
import * as v from "valibot";
import { CHANGELOG_CHECK_USAGE, isReleasePackageId, RELEASE_PACKAGES } from "./release-packages.ts";
import {
  createLogger,
  fromRepoRoot,
  NonEmptyString,
  parse,
  ParseError,
  readPackageJson,
  readFile,
} from "../lib/utils.ts";

const logger = createLogger();

function hasVersionHeading(changelog: string, version: string): boolean {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## \\[${escaped}\\](?:\\s|$)`, "m");
  return heading.test(changelog);
}

class MissingVersionHeadingError extends TaggedError("MissingVersionHeadingError")<{
  version: string;
  message: string;
}>() {
  constructor(version: string) {
    const message = `CHANGELOG.md is missing a section heading for version ${version}.
Add a heading like "## [${version}] - YYYY-MM-DD" before publishing.`;
    super({ version, message });
  }
}

const main = Op(function* (packageIdArg: string | undefined) {
  if (!packageIdArg || !isReleasePackageId(packageIdArg)) {
    return yield* new ParseError({
      message: CHANGELOG_CHECK_USAGE,
      issues: [],
      input: packageIdArg,
    });
  }

  const releasePackage = RELEASE_PACKAGES[packageIdArg];
  const packageJsonPath = yield* fromRepoRoot(`${releasePackage.packageDir}/package.json`);
  const packageJson = yield* readPackageJson(packageJsonPath);
  const { version } = yield* parse(v.object({ version: NonEmptyString }), packageJson);

  const changelogPath = yield* fromRepoRoot(`${releasePackage.packageDir}/CHANGELOG.md`);
  const changelog = yield* readFile(changelogPath);

  if (!hasVersionHeading(changelog, version)) {
    return yield* new MissingVersionHeadingError(version);
  }

  return version;
});

void main.run(process.argv[2]).then((result) => {
  result.match({
    ok: (version) => {
      logger.info(`changelog version check passed for version ${version}`);
      process.exit(0);
    },
    err: (error) => {
      logger.error(error);
      process.exit(1);
    },
  });
});
