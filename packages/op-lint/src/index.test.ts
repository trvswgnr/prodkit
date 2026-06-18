import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RuleTester } from "eslint";
import { describe, expect, test } from "vitest";
import { plugin as opLintPlugin, requireYieldStarRule } from "./index.js";
import { setupTempOpLintProject, writeDefaultTsConfig } from "./test-support/op-lint-fixture.js";

RuleTester.describe = describe;
RuleTester.it = test;

function diagnosticLabelSnippets(source: string, diagnostics: readonly unknown[]): string[] {
  const snippets: string[] = [];

  for (const diagnostic of diagnostics) {
    if (typeof diagnostic !== "object" || diagnostic === null || !("labels" in diagnostic)) {
      continue;
    }
    const labels = diagnostic.labels;
    if (!Array.isArray(labels)) continue;

    for (const label of labels) {
      if (typeof label !== "object" || label === null || !("span" in label)) continue;
      const { span } = label;
      if (typeof span !== "object" || span === null) continue;
      if (!("offset" in span) || !("length" in span)) continue;
      if (typeof span.offset !== "number" || typeof span.length !== "number") continue;

      snippets.push(source.slice(span.offset, span.offset + span.length));
    }
  }

  return snippets;
}

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
    const project = setupTempOpLintProject();
    const { betterResultRoot, distEntry, opPackageRoot, oxlintBin, tempDir } = project;

    expect(existsSync(distEntry), `${distEntry} should exist before the smoke test`).toBe(true);
    expect(existsSync(oxlintBin), `${oxlintBin} should exist before the smoke test`).toBe(true);
    expect(existsSync(opPackageRoot), `${opPackageRoot} should exist before the smoke test`).toBe(
      true,
    );
    expect(
      existsSync(betterResultRoot),
      `${betterResultRoot} should exist before the smoke test`,
    ).toBe(true);

    try {
      project.writeFile(
        "plugin.mjs",
        `export { default } from ${JSON.stringify(pathToFileURL(distEntry).href)};\n`,
      );
      project.writeJson(".oxlintrc.json", {
        jsPlugins: [{ name: "prodkit-op", specifier: "./plugin.mjs" }],
        rules: {
          "prodkit-op/require-yield-star": "error",
        },
      });
      writeDefaultTsConfig(project);
      project.writeFile(
        "ops.ts",
        [
          'import { Op } from "@prodkit/op";',
          "",
          'export const importedOperation = Op.of("ok");',
          "",
        ].join("\n"),
      );
      const fixtureSource = [
        'import { Op, Op as Operation, type Op as OpType } from "@prodkit/op";',
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
        "const Console = {",
        "  info: (...args: unknown[]) => Op.of(undefined).tap(() => console.info(...args)),",
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
        "const validDivide = Op(function* (a: number, b: number) {",
        '  yield* Console.info("divide", a, b);',
        "  return a / b;",
        "});",
        "",
        "const aliasedProgram = Operation(function* () {",
        "  Operation.of(3);",
        "});",
        "",
        "const shadowedOpName = Op(function* () {",
        "  const Op = { of: (value: number) => value };",
        "  Op.of(999);",
        "  return yield* Operation.of(1);",
        "});",
        "",
        "const program = Op(function* () {",
        "  Op.of(1);",
        "  direct;",
        "  alias;",
        "  importedOperation;",
        "  service.stored;",
        "  service.load();",
        '  Console.info("divide", 1, 2);',
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
        "void validDivide;",
        "void aliasedProgram;",
        "void shadowedOpName;",
        "void program;",
        "void returned;",
        "void yielded;",
        "void awaited;",
        "void generic(direct);",
        "",
      ].join("\n");
      project.writeFile("fixture.ts", fixtureSource);

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

      const snippets = diagnosticLabelSnippets(fixtureSource, opDiagnostics);

      expect(opDiagnostics).toHaveLength(12);
      expect(snippets).toContain("Operation.of(3);");
      expect(snippets).not.toContain("Op.of(999)");
      expect(snippets).not.toContain("return a / b");
      expect(output).toContain("Compose this Op with yield*");
    } finally {
      project.cleanup();
    }
  }, 60_000);

  test("loads through ESLint flat config and applies fixes", () => {
    const project = setupTempOpLintProject("prodkit-op-lint-eslint-");
    const { betterResultRoot, distEntry, eslintBin, opPackageRoot, tempDir } = project;

    expect(existsSync(distEntry), `${distEntry} should exist before the smoke test`).toBe(true);
    expect(existsSync(eslintBin), `${eslintBin} should exist before the smoke test`).toBe(true);
    expect(existsSync(opPackageRoot), `${opPackageRoot} should exist before the smoke test`).toBe(
      true,
    );
    expect(
      existsSync(betterResultRoot),
      `${betterResultRoot} should exist before the smoke test`,
    ).toBe(true);

    const fixturePath = project.writeFile(
      "fixture.js",
      [
        'import { Op } from "@prodkit/op";',
        "",
        "const direct = Op.of(1);",
        "",
        "const program = Op(function* () {",
        "  Op.of(1);",
        "  {",
        "    const Op = { of: (value) => value };",
        "    Op.of(999);",
        "  }",
        "  return direct;",
        "});",
        "",
        "void program;",
        "",
      ].join("\n"),
    );

    try {
      project.writeFile(
        "eslint.config.mjs",
        [
          `import prodkitOp from ${JSON.stringify(pathToFileURL(distEntry).href)};`,
          "",
          "export default [",
          "  {",
          '    files: ["**/*.js"],',
          "    languageOptions: {",
          '      ecmaVersion: "latest",',
          '      sourceType: "module",',
          "    },",
          "    plugins: {",
          '      "prodkit-op": prodkitOp,',
          "    },",
          "    rules: {",
          '      "prodkit-op/require-yield-star": "error",',
          "    },",
          "  },",
          "];",
          "",
        ].join("\n"),
      );
      writeDefaultTsConfig(project, { allowJs: true, include: ["*.js"] });

      const reportResult = spawnSync(
        process.execPath,
        [eslintBin, "--format", "json", fixturePath],
        {
          cwd: tempDir,
          encoding: "utf8",
        },
      );
      const reportOutput = `${reportResult.stdout}\n${reportResult.stderr}`;

      expect(reportResult.status, reportOutput).toBe(1);
      const reportJson = JSON.parse(reportResult.stdout);
      const messages: unknown[] =
        Array.isArray(reportJson) &&
        reportJson[0] !== undefined &&
        typeof reportJson[0] === "object" &&
        reportJson[0] !== null &&
        "messages" in reportJson[0] &&
        Array.isArray(reportJson[0].messages)
          ? reportJson[0].messages
          : [];

      expect(messages).toHaveLength(2);
      expect(reportOutput).toContain("prodkit-op/require-yield-star");

      const fixResult = spawnSync(process.execPath, [eslintBin, "--fix", fixturePath], {
        cwd: tempDir,
        encoding: "utf8",
      });
      const fixOutput = `${fixResult.stdout}\n${fixResult.stderr}`;

      expect(fixResult.status, fixOutput).toBe(0);
      expect(readFileSync(fixturePath, "utf8")).toContain(
        [
          "const program = Op(function* () {",
          "  yield* Op.of(1);",
          "  {",
          "    const Op = { of: (value) => value };",
          "    Op.of(999);",
          "  }",
          "  return yield* direct;",
          "});",
        ].join("\n"),
      );
    } finally {
      project.cleanup();
    }
  }, 60_000);

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
      "function* notAnOpGenerator() { Op.of(1); return Op.of(2); }",
      "const program = Op(function* () { function* nested() { Op.of(1); return Op.of(2); } return yield* Op.of(3); });",
      "const Op = Object.assign((gen) => gen, { of: (value) => value }); const program = Op(function* () { Op.of(1); });",
      'import { Op } from "@prodkit/op"; const program = Op(function* () { { const Op = { of: (value) => value }; Op.of(1); } return yield* Op.of(2); });',
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
      {
        code: 'import { Op as Operation } from "@prodkit/op"; const program = Operation(function* () { Operation.of(1); });',
        output:
          'import { Op as Operation } from "@prodkit/op"; const program = Operation(function* () { yield* Operation.of(1); });',
        errors: [{ messageId: "missingYieldStar" }],
      },
    ],
    assertionOptions: {
      requireMessage: "messageId",
    },
  });
});
