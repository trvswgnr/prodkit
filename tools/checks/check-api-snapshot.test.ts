import assert from "node:assert/strict";
import { test } from "node:test";
import { readRepoRoot } from "../lib/utils.ts";
import { checkPublicApiManifest } from "./check-api-snapshot.ts";
import {
  MANIFEST_VERSION,
  PUBLIC_API_ENTRYPOINTS,
  buildPublicApiManifest,
  normalizeSignature,
} from "./lib/op-public-api-snapshot.ts";

void test("normalizeSignature strips relative import specifiers", () => {
  assert.equal(normalizeSignature('Op<import("./core/meta.js").EmptyMeta>'), "Op<EmptyMeta>");
});

void test("public API manifest covers application-tier entrypoints", () => {
  const manifest = buildPublicApiManifest(readRepoRoot());

  assert.equal(manifest.version, MANIFEST_VERSION);
  assert.deepEqual(
    manifest.entries.map((entry) => entry.id),
    PUBLIC_API_ENTRYPOINTS.map((entry) => entry.id),
  );

  const main = manifest.entries.find((entry) => entry.id === "@prodkit/op");
  assert.ok(main);
  assert.ok(main.exports.some((item) => item.name === "Op" && item.kind === "value"));
  assert.ok(main.exports.some((item) => item.name === "Op" && item.kind === "type"));
});

void test("live repo public API manifest is up to date", () => {
  checkPublicApiManifest(readRepoRoot());
});
