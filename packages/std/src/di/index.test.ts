import { assert, describe, expect, expectTypeOf, test } from "vitest";
import ts from "typescript";
import { Op, TimeoutError } from "@prodkit/op";
import { UnhandledException } from "better-result";
import * as std from "../index.js";
import { InferReqs, MissingDependencyError, type DependencyValue } from "./internal.js";
import { DI, type Dependency } from "./index.js";

class DatabaseError extends Error {
  readonly _tag = "DatabaseError";
}

interface User {
  readonly id: string;
}

interface Database {
  query: Op<User, DatabaseError, [sql: string, params: unknown[]]>;
}

class DatabaseDependency extends DI.Dependency("DatabaseDependency")<Database> {}

describe("DI", () => {
  test("keeps dependency names as discriminators", () => {
    expectTypeOf(DatabaseDependency).toExtend<Dependency<Database, "DatabaseDependency">>();
    expectTypeOf<DependencyValue<typeof DatabaseDependency>>().toEqualTypeOf<Database>();
  });

  test("exports dependency injection helpers from the root namespace", () => {
    expect(std.DI.DI).toBe(DI);
    expect(std.DI.Dependency).toBe(DI.Dependency);
  });

  test("infers dependency needs from yielded dependencies", () => {
    const op = DI.Op(function* () {
      const db = yield* DI.require(DatabaseDependency);
      return yield* db.query("select * from users where id = ?", ["1"]);
    });

    expectTypeOf(op).toEqualTypeOf<DI.Op<User, DatabaseError, [], DatabaseDependency>>();

    const provided = op.use(
      DI.singleton(DatabaseDependency, {
        query: Op(function* (_sql: string, _params: unknown[]) {
          return { id: "1" };
        }).mapErr((error): DatabaseError => error),
      }),
    );

    expectTypeOf(provided).toEqualTypeOf<DI.Op<User, DatabaseError, [], never>>();
    expectTypeOf(provided.run()).toEqualTypeOf<ReturnType<Op<User, DatabaseError, []>["run"]>>();
  });

  test("runs with provided dependencies", async () => {
    const calls: string[] = [];
    const db: Database = {
      query: Op(function* (sql: string, params: unknown[]) {
        calls.push(`${sql}:${params[0]}`);
        return { id: String(params[0]) };
      }).mapErr((error): DatabaseError => error),
    };
    const op = DI.Op(function* (id: string) {
      const dependency = yield* DI.require(DatabaseDependency);
      return yield* dependency.query("user", [id]);
    }).use(DI.singleton(DatabaseDependency, db));

    const result = await op.run("123");

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ id: "123" });
    expect(calls).toEqual(["user:123"]);
  });

  test("accepts dependency implementations directly in use(...)", async () => {
    class InMemoryDatabaseDependency extends DatabaseDependency implements Database {
      query = Op(function* (_sql: string, params: unknown[]) {
        return { id: String(params[0]) };
      }).mapErr((error): DatabaseError => error);
    }

    const op = DI.Op(function* (id: string) {
      const db = yield* DI.require(DatabaseDependency);
      return yield* db.query("user", [id]);
    }).use(new InMemoryDatabaseDependency());

    expectTypeOf(op).toEqualTypeOf<DI.Op<User, DatabaseError, [id: string], never>>();

    const result = await op.run("456");
    expect(result.unwrap()).toEqual({ id: "456" });
  });

  test("lazy dependencies resolve once per run and re-evaluate on next run", async () => {
    let resolves = 0;
    const op = DI.Op(function* (id: string) {
      const db1 = yield* DI.require(DatabaseDependency);
      const db2 = yield* DI.require(DatabaseDependency);
      expect(db1).toBe(db2);
      return yield* db1.query("user", [id]);
    }).use(
      DI.scoped(DatabaseDependency, () => {
        resolves += 1;
        return {
          query: Op(function* (_sql: string, params: unknown[]) {
            return { id: String(params[0]) };
          }).mapErr((error): DatabaseError => error),
        } satisfies Database;
      }),
    );

    const first = await op.run("a");
    const second = await op.run("b");

    expect(first.unwrap()).toEqual({ id: "a" });
    expect(second.unwrap()).toEqual({ id: "b" });
    expect(resolves).toBe(2);
  });

  test("lazy dependency factory failures surface as unhandled runtime failures", async () => {
    const op = DI.Op(function* () {
      yield* DI.require(DatabaseDependency);
      return "unreachable";
    }).use(
      DI.scoped(DatabaseDependency, () => {
        throw new Error("boom");
      }),
    );

    const result = await op.run();
    expect(result.isErr()).toBe(true);
    const error = result.match({
      ok: () => undefined,
      err: (err) => err,
    });
    assert(UnhandledException.is(error));
    assert(error.cause instanceof Error);
    expect(error.cause.message).toContain("boom");
  });

  test("defaulted generator params still receive explicit run args", async () => {
    const op = DI.Op(function* (id: string = "default") {
      return id;
    }) satisfies DI.Op<string, never, [id?: string | undefined], never>;

    const result = await op.run("explicit");

    expect(result.unwrap()).toBe("explicit");
  });

  test("rest-parameter generators preserve all run args", async () => {
    const op = DI.Op(function* (...values: number[]) {
      return values.reduce((sum, value) => sum + value, 0);
    });

    expectTypeOf(op).toEqualTypeOf<DI.Op<number, never, number[], never>>();

    const result = await op.run(1, 2, 3, 4);

    expect(result.unwrap()).toBe(10);
  });

  test("composes dependency-aware operations", async () => {
    const findUser = DI.Op(function* (id: string) {
      const db = yield* DI.require(DatabaseDependency);
      return yield* db.query("user", [id]);
    });
    const greet = DI.Op(function* (id: string) {
      const user = yield* findUser(id);
      return `hello ${user.id}`;
    });
    const runnable = greet.use(
      DI.singleton(DatabaseDependency, {
        query: Op(function* (_sql: string, params: unknown[]) {
          return { id: String(params[0]) };
        }).mapErr((error): DatabaseError => error),
      }),
    );

    const result = await runnable.run("abc");

    expect(result.unwrap()).toBe("hello abc");
  });

  test("fluent callbacks can return dependency-aware operations", async () => {
    const findUser = DI.Op(function* (id: string) {
      const db = yield* DI.require(DatabaseDependency);
      return yield* db.query("user", [id]);
    });
    const greet = DI.Op(function* () {
      return "abc";
    })
      .flatMap((id) => findUser(id))
      .map((user) => `hello ${user.id}`);

    expectTypeOf(greet).toEqualTypeOf<DI.Op<string, DatabaseError, [], DatabaseDependency>>();

    const result = await greet
      .use(
        DI.singleton(DatabaseDependency, {
          query: Op(function* (_sql: string, params: unknown[]) {
            return { id: String(params[0]) };
          }).mapErr((error): DatabaseError => error),
        }),
      )
      .run();

    expect(result.unwrap()).toBe("hello abc");
  });

  test("policy wrappers can be configured before or after dependency wiring", async () => {
    const db: Database = {
      query: Op(function* (_sql: string, params: unknown[]) {
        return { id: String(params[0]) };
      }).mapErr((error): DatabaseError => error),
    };
    const findUser = DI.Op(function* (id: string) {
      const dependency = yield* DI.require(DatabaseDependency);
      return yield* dependency.query("user", [id]);
    });

    const policyBeforeProvisioning = findUser
      .withTimeout(1_000)
      .use(DI.singleton(DatabaseDependency, db));
    expectTypeOf(policyBeforeProvisioning).toEqualTypeOf<
      DI.Op<User, DatabaseError | TimeoutError, [id: string], never>
    >();

    const policyAfterProvisioning = findUser
      .use(DI.singleton(DatabaseDependency, db))
      .withTimeout(1_000);
    expectTypeOf(policyAfterProvisioning).toEqualTypeOf<
      DI.Op<User, DatabaseError | TimeoutError, [id: string], never>
    >();

    const before = await policyBeforeProvisioning.run("before");
    const after = await policyAfterProvisioning.run("after");

    expect(before.unwrap()).toEqual({ id: "before" });
    expect(after.unwrap()).toEqual({ id: "after" });
  });

  test("all dependencies are required", async () => {
    class TestDependency1 extends DI.Dependency("TestDependency1")<{}> {}
    class TestDependency2 extends DI.Dependency("TestDependency2")<{}> {}
    class TestDependency3 extends DI.Dependency("TestDependency3")<{}> {}

    const op = DI.Op(function* () {
      yield* DI.require(TestDependency1);
      yield* DI.require(TestDependency2);
      yield* DI.require(TestDependency3);
    });

    expectTypeOf(op).toEqualTypeOf<
      DI.Op<void, never, [], TestDependency1 | TestDependency2 | TestDependency3>
    >();

    type OpRequirements = InferReqs<typeof op>;
    expectTypeOf<OpRequirements>().toEqualTypeOf<
      TestDependency1 | TestDependency2 | TestDependency3
    >();

    const provided = op.use(DI.singleton(TestDependency1, {}));
    expectTypeOf(provided).toEqualTypeOf<
      DI.Op<void, never, [], TestDependency2 | TestDependency3>
    >();

    type ProvidedRequirements = InferReqs<typeof provided>;
    expectTypeOf<ProvidedRequirements>().toEqualTypeOf<TestDependency2 | TestDependency3>();

    // @ts-expect-error - still missing TestDependency2 and TestDependency3
    void (await provided.run());

    const provided2 = op.use(DI.singleton(TestDependency1, {}), DI.singleton(TestDependency2, {}));
    expectTypeOf(provided2).toEqualTypeOf<DI.Op<void, never, [], TestDependency3>>();
    type Provided2Requirements = InferReqs<typeof provided2>;
    expectTypeOf<Provided2Requirements>().toEqualTypeOf<TestDependency3>();

    // @ts-expect-error - still missing TestDependency3
    void (await provided2.run());

    const provided3 = provided2.use(DI.singleton(TestDependency3, {}));
    expectTypeOf(provided3).toEqualTypeOf<DI.Op<void, never, [], never>>();

    const result = await provided3.run();
    expect(result.isOk()).toBe(true);
  });

  test("missing dependencies surface as unhandled runtime failures", async () => {
    const op = DI.Op(function* () {
      yield* DI.require(DatabaseDependency);
      return "unreachable";
    });

    const runnable = op as unknown as Op<string, never, []>;
    const result = await runnable.run();

    expect(result.isErr()).toBe(true);
    const error = result.match({
      ok: () => undefined,
      err: (err) => err,
    });
    assert(UnhandledException.is(error));
    assert(MissingDependencyError.is(error.cause));
    expect(error.cause.key).toBe("DatabaseDependency");
  });

  test("yielding a dependency class without DI.require surfaces the static iterator guard", async () => {
    const op = DI.Op(function* () {
      // @ts-expect-error - DatabaseDependency does not have a [Symbol.iterator] method
      const _db = yield* DatabaseDependency;
      return "unreachable";
    });

    // @ts-expect-error - requirements are unknown
    const result = await op.run();

    expect(result.isErr()).toBe(true);
    const error = result.match({
      ok: () => undefined,
      err: (err: unknown) => err,
    });
    assert(UnhandledException.is(error));
    // @ts-expect-error - console is not defined in the test environment
    // oxlint-disable-next-line no-console
    console.log(error.cause);
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(String(error.cause)).toContain(
      "Use DI.require(dependency) to require a dependency binding",
    );
  });
});

describe("DI implementation hygiene", () => {
  test("does not inspect generator Function.length", () => {
    const source = ts.sys.readFile(`${ts.sys.getCurrentDirectory()}/src/di/index.ts`);

    expect(source).not.toContain("f.length");
  });

  test("quick info for composed operations shows resolved dependency requirements", () => {
    const cwd = ts.sys.getCurrentDirectory();
    const configPath = `${cwd}/tsconfig.json`;
    const sourcePath = `${cwd}/src/di/index.test.ts`;
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

    if (configFile.error) {
      throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
    }

    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, cwd);
    const sourceText = ts.sys.readFile(sourcePath);
    expect(sourceText).toBeDefined();
    if (sourceText === undefined) return;

    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    let composedPosition = -1;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "composed"
      ) {
        composedPosition = node.name.getStart(sourceFile) + 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(composedPosition).toBeGreaterThan(0);

    const servicesHost: ts.LanguageServiceHost = {
      getScriptFileNames: () => parsed.fileNames,
      getScriptVersion: () => "0",
      getScriptSnapshot: (fileName) => {
        if (!ts.sys.fileExists(fileName)) return undefined;
        return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? "");
      },
      getCurrentDirectory: () => cwd,
      getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
    };

    const languageService = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
    const quickInfo = languageService.getQuickInfoAtPosition(sourcePath, composedPosition);
    expect(quickInfo).toBeDefined();
    if (quickInfo === undefined) return;

    const display = ts.displayPartsToString(quickInfo.displayParts ?? []);
    expect(display).toBe(
      "const composed: DI.Op<string, DatabaseError, [], DatabaseDependency | TestDependency>",
    );
  });
});

describe("composition", () => {
  test("dependencies bubble up to the operation return type", () => {
    const op1 = DI.Op(function* () {
      const db = yield* DI.require(DatabaseDependency);
      return yield* db.query("select * from users where id = ?", ["1"]);
    });

    expectTypeOf(op1).toEqualTypeOf<DI.Op<User, DatabaseError, [], DatabaseDependency>>();

    class TestDependency extends DI.Dependency("TestDependency")<{ a: string }> {}
    const op2 = DI.Op(function* () {
      const db = yield* DI.require(TestDependency);
      return db.a;
    });

    expectTypeOf(op2).toEqualTypeOf<DI.Op<string, never, [], TestDependency>>();

    // this name must not change for the hygiene test above to pass
    const composed = DI.Op(function* () {
      const a = yield* op1;
      const b = yield* op2;
      return `${a} ${b}`;
    });

    expectTypeOf(composed).toEqualTypeOf<
      DI.Op<string, DatabaseError, [], DatabaseDependency | TestDependency>
    >();
  });
});
