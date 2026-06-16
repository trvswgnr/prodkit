import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  test("loads through Oxlint JavaScript plugins and reports a direct misuse", () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const repoRoot = resolve(packageRoot, "../..");
    const distEntry = resolve(packageRoot, "dist/index.mjs");
    const oxlintBin = resolve(repoRoot, "node_modules/oxlint/bin/oxlint");

    expect(existsSync(distEntry), `${distEntry} should exist before the smoke test`).toBe(true);
    expect(existsSync(oxlintBin), `${oxlintBin} should exist before the smoke test`).toBe(true);

    const tempDir = mkdtempSync(resolve(tmpdir(), "prodkit-op-lint-"));

    try {
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
        resolve(tempDir, "fixture.ts"),
        [
          'import { Op } from "@prodkit/op";',
          "",
          "const program = Op(function* () {",
          "  Op.of(1);",
          "  return yield* Op.of(2);",
          "});",
          "",
          "void program;",
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
      expect(output).toContain("prodkit-op(require-yield-star)");
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
      "function notAnOpGenerator() { Op.of(1); }",
    ],
    invalid: [
      {
        code: "const program = Op(function* () { Op.of(1); });",
        errors: [{ messageId: "missingYieldStar" }],
      },
    ],
    assertionOptions: {
      requireMessage: "messageId",
    },
  });
});
