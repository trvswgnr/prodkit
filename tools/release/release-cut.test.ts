import assert from "node:assert/strict";
import { test } from "node:test";
import { ChangelogError, promoteUnreleased } from "./release-cut.ts";

const NEXT_VERSION = "1.2.4";
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

void test("promotes real notes and removes the unreleased placeholder", async () => {
  const updated = await promote(`# Changelog

## [Unreleased]

### Added

- No entries yet.

### Fixed

- Release notes survive.

## [1.2.3] - 2026-06-01

### Changed

- Previous release.
`);

  const release = releasedSection(updated);
  assert.equal(
    release,
    `## [1.2.4] - 2026-06-24

### Added

### Fixed

- Release notes survive.`,
  );
  assert.match(updated, /## \[Unreleased\]\n\n### Added\n\n- No entries yet\./);
  assert.match(updated, /## \[1\.2\.3\] - 2026-06-01/);
});

void test("rejects a placeholder-only unreleased section as empty", async () => {
  const error = await promoteFailure(`# Changelog

## [Unreleased]

### Added

- No entries yet.

## [1.2.3] - 2026-06-01

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

## [1.2.3] - 2026-06-01

### Changed

- Previous release.
`);

  assert.equal(
    releasedSection(updated),
    `## [1.2.4] - 2026-06-24

### Changed

- Real change.

### Fixed

- Real fix.`,
  );
});

void test("keeps malformed changelog failures for missing Unreleased", async () => {
  const error = await promoteFailure(`# Changelog

## [1.2.3] - 2026-06-01

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
