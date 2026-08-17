import assert from "node:assert/strict";
import { test } from "node:test";
import { bumpVersion, ChangelogError, planRelease, promoteUnreleased } from "./release-cut.ts";

const CURRENT_VERSION = "0.2.2";
const NEXT_VERSION = "1.0.0";
const RELEASE_DATE = "2026-06-24";

async function promote(changelog: string): Promise<string> {
  const result = await promoteUnreleased(changelog, NEXT_VERSION, RELEASE_DATE).run();
  assert(result.isOk(), "promotion should succeed");
  return result.value;
}

async function promoteFailure(changelog: string): Promise<unknown> {
  const result = await promoteUnreleased(changelog, NEXT_VERSION, RELEASE_DATE).run();
  assert(result.isErr(), "promotion should fail");
  return result.error;
}

function releasedSection(changelog: string): string {
  const heading = `## [${NEXT_VERSION}] - ${RELEASE_DATE}`;
  const start = changelog.indexOf(heading);
  assert.notEqual(start, -1, "promoted release heading should exist");

  const nextHeading = changelog.indexOf("\n## [", start + heading.length);
  return changelog.slice(start, nextHeading === -1 ? undefined : nextHeading).trimEnd();
}

void test("calculates 0.2.2 -> 1.0.0 for a major release", async () => {
  const result = await bumpVersion(CURRENT_VERSION, "major").run();

  assert(result.isOk(), "major version calculation should succeed");
  assert.equal(result.value, NEXT_VERSION);
});

void test("names the planned tag from the major release version", async () => {
  const result = await planRelease("op", CURRENT_VERSION, "major").run();

  assert(result.isOk(), "major release planning should succeed");
  assert.deepEqual(result.value, {
    currentVersion: CURRENT_VERSION,
    nextVersion: NEXT_VERSION,
    npmName: "@prodkit/op",
    packageId: "op",
    tag: "op-v1.0.0",
  });
});

void test("promotes major release notes and removes the unreleased placeholder", async () => {
  const updated = await promote(`# Changelog

## [Unreleased]

### Added

- No entries yet.

### Fixed

- Release notes survive.

## [0.2.2] - 2026-06-01

### Changed

- Previous release.
`);

  const release = releasedSection(updated);
  assert.equal(
    release,
    `## [1.0.0] - 2026-06-24

### Added

### Fixed

- Release notes survive.`,
  );
  assert.match(updated, /## \[Unreleased\]\n\n### Added\n\n- No entries yet\./);
  assert.match(updated, /## \[0\.2\.2\] - 2026-06-01/);
});

void test("rejects a placeholder-only unreleased section as empty", async () => {
  const error = await promoteFailure(`# Changelog

## [Unreleased]

### Added

- No entries yet.

## [0.2.2] - 2026-06-01

### Changed

- Previous release.
`);

  assert(error instanceof ChangelogError);
  assert.match(error.message, /has no release notes/);
});

void test("promotes notes unchanged when the placeholder is absent", async () => {
  const updated = await promote(`# Changelog

## [Unreleased]

### Changed

- Real change.

### Fixed

- Real fix.

## [0.2.2] - 2026-06-01

### Changed

- Previous release.
`);

  assert.equal(
    releasedSection(updated),
    `## [1.0.0] - 2026-06-24

### Changed

- Real change.

### Fixed

- Real fix.`,
  );
});

void test("keeps malformed changelog failures for missing Unreleased", async () => {
  const error = await promoteFailure(`# Changelog

## [0.2.2] - 2026-06-01

### Changed

- Previous release.
`);

  assert(error instanceof ChangelogError);
  assert.match(error.message, /missing "## \[Unreleased\]"/);
});

void test("keeps malformed changelog failures when no released section follows Unreleased", async () => {
  const error = await promoteFailure(`# Changelog

## [Unreleased]

### Fixed

- Real fix.
`);

  assert(error instanceof ChangelogError);
  assert.match(error.message, /must include at least one released section/);
});
