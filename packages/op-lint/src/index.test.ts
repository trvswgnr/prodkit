import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RuleTester } from "eslint";
import { describe, expect, test } from "vitest";
import { plugin as opLintPlugin, requireYieldStarRule } from "./index.js";

RuleTester.describe = describe;
RuleTester.it = test;

describe("@prodkit/op-lint plugin", () => {
  test("exports the require-yield-star rule with documentation metadata", () => {
    expect(opLintPlugin.meta.name).toBe("@prodkit/op-lint");
    expect(opLintPlugin.rules["require-yield-star"]).toBe(requireYieldStarRule);
    expect(requireYieldStarRule.meta.messages.missingYieldStar).toContain("yield*");
    expect(requireYieldStarRule.meta.docs.url).toBe(
      "https://github.com/trvswgnr/prodkit/tree/main/packages/op-lint#require-yield-star",
    );
  });

  test("loads through Oxlint JavaScript plugins and reports direct and typed misuses", () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const repoRoot = resolve(packageRoot, "../..");
    const distEntry = resolve(packageRoot, "dist/index.mjs");
    const oxlintBin = resolve(repoRoot, "node_modules/oxlint/bin/oxlint");
    const opPackageRoot = resolve(packageRoot, "../op");
    const betterResultRoot = resolve(opPackageRoot, "node_modules/better-result");

    expect(existsSync(distEntry), `${distEntry} should exist before the smoke test`).toBe(true);
    expect(existsSync(oxlintBin), `${oxlintBin} should exist before the smoke test`).toBe(true);
    expect(existsSync(opPackageRoot), `${opPackageRoot} should exist before the smoke test`).toBe(
      true,
    );
    expect(
      existsSync(betterResultRoot),
      `${betterResultRoot} should exist before the smoke test`,
    ).toBe(true);

    const tempDir = mkdtempSync(resolve(tmpdir(), "prodkit-op-lint-"));

    try {
      mkdirSync(resolve(tempDir, "node_modules/@prodkit"), { recursive: true });
      symlinkSync(opPackageRoot, resolve(tempDir, "node_modules/@prodkit/op"), "dir");
      symlinkSync(betterResultRoot, resolve(tempDir, "node_modules/better-result"), "dir");

      writeFileSync(
        resolve(tempDir, "plugin.mjs"),
        `export { default } from ${JSON.stringify(pathToFileURL(distEntry).href)};\n`,
        "utf8",
      );
      writeFileSync(
        resolve(tempDir, ".oxlintrc.json"),
        `${JSON.stringify(
          {
            jsPlugins: [{ name: "prodkit-op", specifier: "./plugin.mjs" }],
            rules: {
              "prodkit-op/require-yield-star": "error",
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      writeFileSync(
        resolve(tempDir, "tsconfig.json"),
        `${JSON.stringify(
          {
            compilerOptions: {
              module: "NodeNext",
              moduleResolution: "NodeNext",
              skipLibCheck: true,
              strict: true,
              target: "ES2022",
            },
            include: ["*.ts"],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      writeFileSync(
        resolve(tempDir, "ops.ts"),
        [
          'import { Op } from "@prodkit/op";',
          "",
          'export const importedOperation = Op.of("ok");',
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        resolve(tempDir, "fixture.ts"),
        [
          'import { Op, type Op as OpType } from "@prodkit/op";',
          'import { importedOperation } from "./ops.js";',
          "",
          "const direct = Op.of(1);",
          "const alias = direct;",
          "",
          "declare const service: {",
          "  readonly stored: OpType<boolean, never, []>;",
          "  load(): OpType<number, never, []>;",
          "};",
          "",
          "function generic<T extends OpType<number, never, []>>(op: T) {",
          "  return Op(function* () {",
          "    op;",
          "  });",
          "}",
          "",
          "const iterable = { *[Symbol.iterator]() { yield 1; return 1; } };",
          'const lookalike = { _tag: "Op", run() {}, with() {}, on() {}, map() {}, mapErr() {}, flatMap() {}, tap() {}, tapErr() {}, recover() {} };',
          "",
          "const program = Op(function* () {",
          "  Op.of(1);",
          "  direct;",
          "  alias;",
          "  importedOperation;",
          "  service.stored;",
          "  service.load();",
          "  iterable;",
          "  lookalike;",
          "  return yield* Op.of(2);",
          "});",
          "",
          "const returned = Op(function* () {",
          "  return direct;",
          "});",
          "",
          "const yielded = Op(function* () {",
          "  yield direct;",
          "});",
          "",
          "const awaited = Op(async function* () {",
          "  await service.load();",
          "});",
          "",
          "void program;",
          "void returned;",
          "void yielded;",
          "void awaited;",
          "void generic(direct);",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = spawnSync(
        process.execPath,
        [oxlintBin, "--config", ".oxlintrc.json", "--format", "json", "fixture.ts"],
        {
          cwd: tempDir,
          encoding: "utf8",
        },
      );
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status, output).toBe(1);
      const outputJson = JSON.parse(result.stdout);
      const diagnostics: unknown[] =
        typeof outputJson === "object" &&
        outputJson !== null &&
        "diagnostics" in outputJson &&
        Array.isArray(outputJson.diagnostics)
          ? outputJson.diagnostics
          : [];
      const opDiagnostics = diagnostics.filter(
        (diagnostic) =>
          typeof diagnostic === "object" &&
          diagnostic !== null &&
          "code" in diagnostic &&
          diagnostic.code === "prodkit-op(require-yield-star)",
      );

      expect(opDiagnostics).toHaveLength(10);
      expect(output).toContain("Compose this Op with yield*");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  new RuleTester({
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  }).run("require-yield-star", requireYieldStarRule, {
    valid: [
      "const program = Op(function* () { return yield* Op.of(1); });",
      "const program = Op(function* () { const staged = Op.of(1); return yield* staged; });",
      "const program = Op(function* () { items.map(() => Op.of(1)); });",
      "const program = Op(function* () { items.map(() => { return Op.of(1); }); });",
      "function notAnOpGenerator() { Op.of(1); }",
      "function notAGeneratorCallback() { return Op.of(1); }",
    ],
    invalid: [
      {
        code: "const program = Op(function* () { Op.of(1); });",
        output: "const program = Op(function* () { yield* Op.of(1); });",
        errors: [{ messageId: "missingYieldStar" }],
      },
      {
        code: "const program = Op(function* () { return Op.of(1); });",
        output: "const program = Op(function* () { return yield* Op.of(1); });",
        errors: [{ messageId: "missingYieldStar" }],
      },
      {
        code: "const program = Op(function* () { yield Op.of(1); });",
        output: "const program = Op(function* () { yield* Op.of(1); });",
        errors: [{ messageId: "missingYieldStar" }],
      },
      {
        code: "const program = Op(async function* () { await Op.of(1); });",
        output: "const program = Op(async function* () { yield* Op.of(1); });",
        errors: [{ messageId: "missingYieldStar" }],
      },
      {
        code: "const program = Op(async function* () { return await Op.of(1); });",
        output: "const program = Op(async function* () { return yield* Op.of(1); });",
        errors: [{ messageId: "missingYieldStar" }],
      },
    ],
    assertionOptions: {
      requireMessage: "messageId",
    },
  });
});
