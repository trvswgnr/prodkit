import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { Op } from "@prodkit/op";
import * as v from "valibot";
import { TaggedError } from "better-result";

const logger = console;

const NO_ENTRIES_PLACEHOLDER = "- No entries yet.";
const NO_CHANGES_SECTION = "### Changed\n\n- No user-facing changes in this release.";
const UNRELEASED_HEADING = "## [Unreleased]";

const BumpKind = v.union([v.literal("patch"), v.literal("minor"), v.literal("major")]);
type BumpKind = v.InferOutput<typeof BumpKind>;

const PackageJson = v.object({ version: v.pipe(v.string(), v.nonEmpty()) });
type PackageJson = v.InferOutput<typeof PackageJson>;

class ParseError extends TaggedError("ParseError")<{
  message?: string;
  issues: v.BaseIssue<unknown>[];
  input: unknown;
}>() {}

class InvalidJsonError extends TaggedError("InvalidJsonError")<{
  cause: unknown;
  input: string;
}>() {}

class ChangelogError extends TaggedError("ChangelogError")<{ message: string }>() {}

class CommandError extends TaggedError("CommandError")<{ cause: unknown; command: string }>() {}

class FileError extends TaggedError("FileError")<{ cause: unknown; path: string }>() {}

const main = Op(function* (dryRun: boolean) {
  const dryRunPrefix = "[dry-run]";

  const info = (message: string) => Op.try(() => logger.info(message));
  const parse = <S extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    schema: S,
    input: unknown,
  ) =>
    Op(function* () {
      const result = v.safeParse(schema, input);
      if (!result.success) {
        return yield* Op.fail(new ParseError({ issues: result.issues, input }));
      }
      return result.output;
    });

  const parseJson = (input: string) =>
    Op.try(
      () => JSON.parse(input) as unknown,
      (cause) => new InvalidJsonError({ cause, input }),
    );

  const readUtf8 = (path: string) =>
    Op.try(
      () => readFile(new URL(path, import.meta.url), "utf8"),
      (cause) => new FileError({ cause, path }),
    );

  const writeUtf8 = (path: string, content: string) => {
    if (dryRun) {
      return info(`${dryRunPrefix} would write ${path}`);
    }

    return Op.try(
      (signal) => writeFile(new URL(path, import.meta.url), content, { encoding: "utf8", signal }),
      (cause) => new FileError({ cause, path }),
    );
  };

  const parseBumpKind = Op(function* (arg: string | undefined) {
    const result = v.safeParse(BumpKind, arg);
    if (!result.success) {
      return yield* new ParseError({
        message: "usage: node ./scripts/release-cut.ts <patch|minor|major>",
        issues: result.issues,
        input: arg,
      });
    }
    return result.output;
  });

  const parseVersion = Op(function* (value: string) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (!match) {
      return yield* new ParseError({
        message: `unsupported version format: "${value}"`,
        issues: [],
        input: value,
      });
    }

    return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  });

  const bumpVersion = Op(function* (current: string, kind: BumpKind) {
    const [major, minor, patch] = yield* parseVersion(current);
    if (kind === "major") {
      return `${major + 1}.0.0`;
    }

    if (kind === "minor") {
      return `${major}.${minor + 1}.0`;
    }

    return `${major}.${minor}.${patch + 1}`;
  });

  const getCurrentVersion = Op(function* () {
    const raw = yield* readUtf8("../package.json");
    const parsedJson = yield* parseJson(raw);
    const parsed = yield* parse(PackageJson, parsedJson);

    return parsed.version;
  });

  const getReleaseDate = Op.try(() => new Date().toISOString().slice(0, 10));

  const promoteUnreleased = Op(function* (
    changelog: string,
    nextVersion: string,
    releaseDate: string,
  ) {
    const unreleasedStart = changelog.indexOf(UNRELEASED_HEADING);
    if (unreleasedStart === -1) {
      return yield* new ChangelogError({ message: 'CHANGELOG.md is missing "## [Unreleased]"' });
    }

    const nextHeadingStart = changelog.indexOf(
      "\n## [",
      unreleasedStart + UNRELEASED_HEADING.length,
    );
    if (nextHeadingStart === -1) {
      return yield* new ChangelogError({
        message: 'CHANGELOG.md must include at least one released section after "Unreleased"',
      });
    }

    const preamble = changelog.slice(0, unreleasedStart).trimEnd();
    const unreleasedBodyRaw = changelog
      .slice(unreleasedStart + UNRELEASED_HEADING.length, nextHeadingStart)
      .trim();
    const releasedSections = changelog.slice(nextHeadingStart).trimStart();

    const unreleasedBody = unreleasedBodyRaw.replace(NO_ENTRIES_PLACEHOLDER, "").trim();
    const releaseBody = /- /m.test(unreleasedBody) ? unreleasedBody : NO_CHANGES_SECTION;

    const newUnreleased = `${UNRELEASED_HEADING}\n\n### Added\n\n${NO_ENTRIES_PLACEHOLDER}`;
    const newReleaseSection = `## [${nextVersion}] - ${releaseDate}\n\n${releaseBody}`;

    return `${preamble}\n\n${newUnreleased}\n\n${newReleaseSection}\n\n${releasedSections}\n`;
  });

  const run = (command: string) => {
    if (dryRun) {
      return info(`${dryRunPrefix} would run: ${command}`);
    }

    return Op.try(
      () => execSync(command, { stdio: "inherit" }),
      (cause) => new CommandError({ cause, command }),
    );
  };

  const bumpKind = yield* parseBumpKind(process.argv[2]);
  const currentVersion = yield* getCurrentVersion();
  const nextVersion = yield* bumpVersion(currentVersion, bumpKind);
  const releaseDate = yield* getReleaseDate();

  const changelog = yield* readUtf8("../CHANGELOG.md");
  const updatedChangelog = yield* promoteUnreleased(changelog, nextVersion, releaseDate);
  yield* writeUtf8("../CHANGELOG.md", updatedChangelog);

  yield* run(`npm version ${bumpKind} --no-git-tag-version`);
  yield* run("npm run fmt");
  yield* run("npm run release:prepare");
  yield* run("git add CHANGELOG.md package.json package-lock.json");
  yield* run(`git commit -m "${nextVersion}"`);
  yield* run(`git tag v${nextVersion}`);

  if (dryRun) {
    yield* info(`${dryRunPrefix} release cut simulation complete for v${nextVersion}`);
  }

  return { nextVersion, dryRun };
});

main
  .run(
    // defaults to dry run to avoid accidental release cuts
    Boolean(JSON.parse(process.env.DRY_RUN || "1")),
  )
  .then((result) => {
    result.match({
      ok: ({ nextVersion, dryRun }) => {
        if (dryRun) {
          logger.info(`dry run complete: v${nextVersion}\n`);
          logger.info("no files, commits, or tags were changed\n");
          logger.info("next step: run with DRY_RUN=0 to cut the release\n");
          return;
        }

        logger.info(`release cut complete: v${nextVersion}\n`);
        logger.info("next step: npm run release:push\n");
      },
      err: (error) => {
        logger.error(error);
        process.exit(1);
      },
    });
  });
