import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readRepoRoot } from "../lib/utils.ts";
import { checkPublicDocs, collectHeadingSlugs, slugifyHeading } from "./lib/check-public-docs.ts";

void test("live repo satisfies public docs link contract", () => {
  const issues = checkPublicDocs(readRepoRoot());
  assert.deepEqual(issues, []);
});

void test("slugifyHeading matches package README policy anchors", () => {
  assert.equal(slugifyHeading("`.with(policy)`"), "withpolicy");
  assert.equal(slugifyHeading("Retry defaults"), "retry-defaults");
  const slugs = collectHeadingSlugs("## Retry defaults\n\n### `.with(policy)`\n");
  assert.deepEqual(slugs, ["retry-defaults", "withpolicy"]);
});

void test("broken relative and github links are reported", () => {
  const root = mkdtempSync(path.join(tmpdir(), "public-docs-check-"));
  mkdirSync(path.join(root, "packages/op/docs"), { recursive: true });
  mkdirSync(path.join(root, "packages/op-lint"), { recursive: true });
  mkdirSync(path.join(root, "packages/std"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "[root](packages/op/README.md)\n", "utf8");
  writeFileSync(
    path.join(root, "packages/op/README.md"),
    [
      "[missing](docs/missing.md)",
      "[blob](https://github.com/trvswgnr/prodkit/blob/main/examples/missing.ts)",
      "[anchor](docs/README.md#nope)",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(path.join(root, "packages/op-lint/README.md"), "# @prodkit/op-lint\n", "utf8");
  writeFileSync(path.join(root, "packages/std/README.md"), "# @prodkit/std\n", "utf8");
  writeFileSync(path.join(root, "packages/op/docs/README.md"), "## Guides\n", "utf8");

  const issues = checkPublicDocs(root);
  assert.equal(issues.length, 3);
  assert.match(issues[0]?.message ?? "", /missing\.md/);
  assert.match(issues[1]?.message ?? "", /examples\/missing\.ts/);
  assert.match(issues[2]?.message ?? "", /anchor #nope/);
});
