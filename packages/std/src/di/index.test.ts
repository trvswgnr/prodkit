import { assert, describe, expect, test } from "vitest";
import { Op, TimeoutError } from "@prodkit/op";
import { UnhandledException } from "better-result";
import { DI } from "./index.js";
import { AlreadyProvidedError, MissingDependencyError } from "./internal.js";

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
class LoggerDependency extends DI.Dependency("LoggerDependency")<{
  log: (message: string) => void;
}> {}

const makeDatabase = (calls: string[] = []): Database => ({
  query: Op(function* (sql: string, params: unknown[]) {
    calls.push(`${sql}:${params[0]}`);
    return { id: String(params[0]) };
  }).mapErr((error): DatabaseError => error),
});

function getUnhandledCause(result: Awaited<ReturnType<Op<unknown, unknown, []>["run"]>>): unknown {
  assert(result.isErr(), "result should be Err");
  assert(UnhandledException.is(result.error));
  return result.error.cause;
}

describe("DI cutover runtime", () => {
  test("plain Op can require and run with provided singleton dependencies", async () => {
    const calls: string[] = [];
    const op = Op(function* (id: string) {
      const db = yield* DI.inject(DatabaseDependency);
      return yield* db.query("user", [id]);
    });

    const result = await DI.provide(op, DI.singleton(DatabaseDependency, makeDatabase(calls))).run(
      "123",
    );

    expect(result.unwrap()).toEqual({ id: "123" });
    expect(calls).toEqual(["user:123"]);
  });

  test("missing dependency returns UnhandledException with MissingDependencyError cause", async () => {
    const op = Op(function* () {
      yield* DI.inject(DatabaseDependency);
      return "unreachable";
    });

    // @ts-expect-error - intentional runtime check for missing provision
    const result = await op.run();
    const cause = getUnhandledCause(result);

    assert(MissingDependencyError.is(cause));
    expect(cause.key).toBe("DatabaseDependency");
  });

  test("direct dependency implementation instances resolve correctly", async () => {
    class InMemoryDatabase extends DatabaseDependency implements Database {
      query = Op(function* (_sql: string, params: unknown[]) {
        return { id: String(params[0]) };
      }).mapErr((error): DatabaseError => error);
    }

    const op = Op(function* (id: string) {
      const db = yield* DI.inject(DatabaseDependency);
      return yield* db.query("user", [id]);
    });

    const result = await DI.provide(op, new InMemoryDatabase()).run("456");

    expect(result.unwrap()).toEqual({ id: "456" });
  });

  test("scoped dependencies resolve once per run and again on the next run", async () => {
    let resolves = 0;
    const op = Op(function* (id: string) {
      const db1 = yield* DI.inject(DatabaseDependency);
      const db2 = yield* DI.inject(DatabaseDependency);
      expect(db1).toBe(db2);
      return yield* db1.query("user", [id]);
    });
    const runnable = DI.provide(
      op,
      DI.scoped(DatabaseDependency, () => {
        resolves += 1;
        return makeDatabase();
      }),
    );

    expect((await runnable.run("a")).unwrap()).toEqual({ id: "a" });
    expect((await runnable.run("b")).unwrap()).toEqual({ id: "b" });
    expect(resolves).toBe(2);
  });

  test("nested DI.provide calls merge bindings", async () => {
    const seen: string[] = [];
    const op = Op(function* (id: string) {
      const db = yield* DI.inject(DatabaseDependency);
      const logger = yield* DI.inject(LoggerDependency);
      const user = yield* db.query("user", [id]);
      logger.log(user.id);
      return user;
    });

    const runnable = DI.provide(
      DI.provide(op, DI.singleton(DatabaseDependency, makeDatabase())),
      DI.singleton(LoggerDependency, { log: (message) => seen.push(message) }),
    );

    const result = await runnable.run("abc");

    expect(result.unwrap()).toEqual({ id: "abc" });
    expect(seen).toEqual(["abc"]);
  });

  test("duplicate provisioning returns UnhandledException with AlreadyProvidedError cause", async () => {
    const op = Op(function* () {
      const db = yield* DI.inject(DatabaseDependency);
      return yield* db.query("user", ["1"]);
    });

    const partiallyProvided = DI.provide(op, DI.singleton(DatabaseDependency, makeDatabase()));
    const result = await DI.provide(
      partiallyProvided,
      // @ts-expect-error - op has no remaining deps, specifically testing the runtime guard
      DI.singleton(DatabaseDependency, makeDatabase()),
    ).run();
    const cause = getUnhandledCause(result);

    assert(AlreadyProvidedError.is(cause));
    expect(cause.key).toBe("DatabaseDependency");
  });

  test("policy, lifecycle, release, and fluent paths keep DI context", async () => {
    const db = makeDatabase();
    const findUser = Op(function* (id: string) {
      const dependency = yield* DI.inject(DatabaseDependency);
      return yield* dependency.query("user", [id]);
    });

    const signal: Parameters<typeof findUser.withSignal>[0] = {
      aborted: false,
      reason: undefined,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const cases = [
      DI.provide(
        findUser.withRetry({ maxAttempts: 1, shouldRetry: () => true, getDelay: () => 0 }),
        DI.singleton(DatabaseDependency, db),
      ),
      DI.provide(findUser.withTimeout(1_000), DI.singleton(DatabaseDependency, db)),
      DI.provide(findUser.withSignal(signal), DI.singleton(DatabaseDependency, db)),
      DI.provide(
        findUser.withRelease(() => {}),
        DI.singleton(DatabaseDependency, db),
      ),
      DI.provide(
        findUser.on("enter", () => {}),
        DI.singleton(DatabaseDependency, db),
      ),
      DI.provide(
        findUser.on("exit", () => {}),
        DI.singleton(DatabaseDependency, db),
      ),
      DI.provide(findUser, DI.singleton(DatabaseDependency, db)).withRetry({
        maxAttempts: 1,
        shouldRetry: () => true,
        getDelay: () => 0,
      }),
      DI.provide(findUser, DI.singleton(DatabaseDependency, db)).withTimeout(1_000),
      DI.provide(findUser, DI.singleton(DatabaseDependency, db)).withSignal(signal),
      DI.provide(findUser, DI.singleton(DatabaseDependency, db)).withRelease(() => {}),
      DI.provide(findUser, DI.singleton(DatabaseDependency, db)).on("enter", () => {}),
      DI.provide(findUser, DI.singleton(DatabaseDependency, db)).on("exit", () => {}),
    ];

    for (const [index, candidate] of cases.entries()) {
      const result = await candidate.run(`id-${index}`);
      expect(result.unwrap()).toEqual({ id: `id-${index}` });
    }

    expect(
      await DI.provide(
        findUser("flat").flatMap(() => findUser("next")),
        DI.singleton(DatabaseDependency, db),
      ).run(),
    ).toEqual(expect.objectContaining({ value: { id: "next" } }));
    expect(
      await DI.provide(
        findUser("tap").tap(() => findUser("observed")),
        DI.singleton(DatabaseDependency, db),
      ).run(),
    ).toEqual(expect.objectContaining({ value: { id: "tap" } }));
    expect(
      await DI.provide(
        Op.fail("recover" as const).recover(
          (error): error is "recover" => error === "recover",
          () => findUser("recovered"),
        ),
        DI.singleton(DatabaseDependency, db),
      ).run(),
    ).toEqual(expect.objectContaining({ value: { id: "recovered" } }));
  });

  test("timeout typing remains available around provisioned ops", () => {
    const op = DI.provide(
      Op(function* () {
        yield* DI.inject(DatabaseDependency);
      }),
      DI.singleton(DatabaseDependency, makeDatabase()),
    ).withTimeout(1);

    const _timeout: Op<void, TimeoutError, []> = op;
    expect(_timeout).toBe(op);
  });
});
