import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertContractMarkers,
  checkRunnableGatingContract,
} from "./check-runnable-gating-contract.ts";

void test("live repo satisfies runnable gating contract", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  checkRunnableGatingContract(repoRoot);
});

void test("contract markers are found when concatenated across a temp tree", () => {
  const root = mkdtempSync(path.join(tmpdir(), "runnable-gating-"));
  mkdirSync(path.join(root, "packages/op/tests/nested"), { recursive: true });
  writeFileSync(
    path.join(root, "packages/op/vitest.config.ts"),
    `exclude: ["src/core/meta.ts", "src/core/plan/surface.ts"]`,
    "utf8",
  );
  writeFileSync(
    path.join(root, "packages/op/tests/nested/contracts.test.ts"),
    [
      `describe("metadata type contracts", () => {});`,
      `describe("Blocking type contracts", () => {});`,
      `describe("DI type inference", () => {});`,
      `test("Blocking with never payload does not block run", () => {});`,
      `test("missing dependency returns UnhandledException with MissingDependencyError cause", async () => {});`,
    ].join("\n"),
    "utf8",
  );
  checkRunnableGatingContract(root);
});

void test("missing marker fails contract check", () => {
  assert.throws(
    () => assertContractMarkers(`describe("metadata type contracts", () => {});`),
    /Blocking and withBlocking/,
  );
});
