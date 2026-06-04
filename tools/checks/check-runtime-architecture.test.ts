import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertEdgesMatchSources,
  checkRuntimeArchitectureDoc,
  collectDocumentedEdges,
  parseClosedModules,
  RUNTIME_ARCHITECTURE_MD,
} from "./check-runtime-architecture.ts";

function writeModule(root: string, relative: string, body: string): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, "utf8");
}

void test("parseClosedModules reads architecture-check-closed markers", () => {
  const content = `
<!-- architecture-check-closed: packages/op/src/di/internal.ts -->
- \`packages/op/src/foo.ts\` imports \`packages/op/src/bar.ts\`
`;
  const closed = parseClosedModules(content);
  assert.equal(closed.size, 1);
  assert.ok(closed.has("packages/op/src/di/internal.ts"));
});

void test("partial edge requires documented import only", () => {
  const root = mkdtempSync(path.join(tmpdir(), "arch-check-"));
  writeModule(
    root,
    "packages/op/src/core/plan/hub.ts",
    `import { x } from "./leaf.js";\nimport { y } from "../../extra.js";\nexport const hub = x + y;\n`,
  );
  writeModule(root, "packages/op/src/core/plan/leaf.ts", `export const x = 1;\n`);
  writeModule(root, "packages/op/src/extra.ts", `export const y = 2;\n`);

  const edges = collectDocumentedEdges(
    "- `packages/op/src/core/plan/hub.ts` imports `packages/op/src/core/plan/leaf.ts`\n",
  );

  assert.doesNotThrow(() => assertEdgesMatchSources(root, edges, new Set()));
});

void test("closed module rejects undocumented op imports", () => {
  const root = mkdtempSync(path.join(tmpdir(), "arch-check-"));
  writeModule(
    root,
    "packages/op/src/seam/a.ts",
    `import { b } from "./b.js";\nimport { c } from "./c.js";\nexport const a = b + c;\n`,
  );
  writeModule(root, "packages/op/src/seam/b.ts", `export const b = 1;\n`);
  writeModule(root, "packages/op/src/seam/c.ts", `export const c = 2;\n`);

  const edges = collectDocumentedEdges(
    "- `packages/op/src/seam/a.ts` imports `packages/op/src/seam/b.ts`\n",
  );
  const closed = new Set(["packages/op/src/seam/a.ts"]);

  assert.throws(() => assertEdgesMatchSources(root, edges, closed), /missing it/);
});

void test("closed module without edges fails check", () => {
  const root = mkdtempSync(path.join(tmpdir(), "arch-check-"));
  writeModule(root, "packages/op/src/empty.ts", `export const empty = 0;\n`);

  const content = `
<!-- architecture-check-closed: packages/op/src/empty.ts -->
- \`packages/op/src/other.ts\` imports \`packages/op/src/empty.ts\`
`;
  writeModule(
    root,
    "packages/op/src/other.ts",
    `import { empty } from "./empty.js";\nexport const other = empty;\n`,
  );

  assert.throws(
    () => checkRuntimeArchitectureDoc(root, content),
    /closed module.*no documented import edges/,
  );
});

void test("documented edge missing from source fails", () => {
  const root = mkdtempSync(path.join(tmpdir(), "arch-check-"));
  writeModule(root, "packages/op/src/a.ts", `export const a = 1;\n`);

  const edges = collectDocumentedEdges(
    "- `packages/op/src/a.ts` imports `packages/op/src/missing.ts`\n",
  );

  assert.throws(() => assertEdgesMatchSources(root, edges, new Set()), /does not/);
});

void test("checkRuntimeArchitectureDoc surfaces doc path in errors", () => {
  assert.throws(
    () => checkRuntimeArchitectureDoc("/tmp", ""),
    new RegExp(RUNTIME_ARCHITECTURE_MD.replaceAll("/", "\\/")),
  );
});
