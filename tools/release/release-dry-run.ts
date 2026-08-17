import process from "node:process";
import { Op } from "@prodkit/op";
import * as v from "valibot";
import {
  createLogger,
  fromRepoRoot,
  NonEmptyString,
  parse,
  ParseError,
  readFile,
  readPackageJson,
} from "../lib/utils.ts";
import { parseBumpKind, planRelease, promoteUnreleased } from "./release-cut.ts";
import { isReleasePackageId, RELEASE_PACKAGES } from "./release-packages.ts";

const logger = createLogger();
const RELEASE_DRY_RUN_USAGE =
  "usage: node ./tools/release/release-dry-run.ts <op|op-lint|std> <patch|minor|major>";

const main = Op(function* (packageIdArg: string | undefined, bumpKindArg: string | undefined) {
  if (!packageIdArg || !isReleasePackageId(packageIdArg)) {
    return yield* new ParseError({
      message: RELEASE_DRY_RUN_USAGE,
      issues: [],
      input: packageIdArg,
    });
  }

  const bumpKind = yield* parseBumpKind(bumpKindArg, RELEASE_DRY_RUN_USAGE);
  const releasePackage = RELEASE_PACKAGES[packageIdArg];
  const packageJsonPath = yield* fromRepoRoot(`${releasePackage.packageDir}/package.json`);
  const packageJson = yield* readPackageJson(packageJsonPath);
  const { version: currentVersion } = yield* parse(
    v.object({ version: NonEmptyString }),
    packageJson,
  );
  const plan = yield* planRelease(packageIdArg, currentVersion, bumpKind);
  const changelogPath = yield* fromRepoRoot(`${releasePackage.packageDir}/CHANGELOG.md`);
  const changelog = yield* readFile(changelogPath);
  const releaseDate = yield* Op.try(() => new Date().toISOString().slice(0, 10));

  yield* promoteUnreleased(changelog, plan.nextVersion, releaseDate);

  return plan;
});

void main.run(process.argv[2], process.argv[3]).then((result) => {
  result.match({
    ok: ({ currentVersion, nextVersion, npmName, tag }) => {
      logger.info(`release dry run passed for ${npmName}`);
      logger.info(`version: ${currentVersion} -> ${nextVersion}`);
      logger.info(`tag: ${tag}`);
      logger.info("no package version, changelog, commit, or tag was changed");
    },
    err: (error) => {
      logger.error(error);
      process.exit(1);
    },
  });
});
