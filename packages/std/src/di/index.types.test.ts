import { describe, expectTypeOf, test } from "vitest";
import { Op } from "@prodkit/op";
import { DI, type Dependency } from "./index.js";
import type {
  DependencyReq,
  DependencyValue,
  InferMetaReqs,
  InferReqs,
  ProvidedReq,
  UseReq,
  WithDIMeta,
} from "./internal.js";

type Assert<T extends true> = T;
type IsEqual<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

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

describe("DI cutover type contracts", () => {
  test("plain non-DI ops have no requirements", () => {
    const op = Op(function* () {
      return 1;
    });

    type _ = Assert<IsEqual<InferReqs<typeof op>, never>>;
  });

  test("DI.require contributes requirements to plain Op", () => {
    const op = Op(function* () {
      const db = yield* DI.require(DatabaseDependency);
      return yield* db.query("user", ["1"]);
    });

    type _ = Assert<IsEqual<InferReqs<typeof op>, DatabaseDependency>>;
  });

  test("multiple and nested requirements infer as a union", () => {
    const findUser = Op(function* (id: string) {
      const db = yield* DI.require(DatabaseDependency);
      return yield* db.query("user", [id]);
    });
    const greet = Op(function* (id: string) {
      const logger = yield* DI.require(LoggerDependency);
      const user = yield* findUser(id);
      logger.log(user.id);
      return user.id;
    });

    expectTypeOf<InferReqs<typeof greet>>().toEqualTypeOf<DatabaseDependency | LoggerDependency>();
  });

  test("provisioning removes only satisfied requirements", () => {
    const op = Op(function* () {
      yield* DI.require(DatabaseDependency);
      yield* DI.require(LoggerDependency);
    });
    const db = {
      query: Op(function* (_sql: string, _params: unknown[]) {
        return { id: "1" };
      }).mapErr((error): DatabaseError => error),
    } satisfies Database;

    const partial = DI.provide(op, DI.singleton(DatabaseDependency, db));
    const full = DI.provide(
      partial,
      DI.scoped(LoggerDependency, () => ({ log: () => {} })),
    );

    type _PartialReqs = Assert<IsEqual<InferReqs<typeof partial>, LoggerDependency>>;
    type _FullReqs = Assert<IsEqual<InferReqs<typeof full>, never>>;
  });

  test("direct implementations satisfy matching dependency tokens only", () => {
    class InMemoryDatabase extends DatabaseDependency implements Database {
      query = Op(function* (_sql: string, params: unknown[]) {
        return { id: String(params[0]) };
      }).mapErr((error): DatabaseError => error);
    }

    const op = Op(function* () {
      yield* DI.require(DatabaseDependency);
      yield* DI.require(LoggerDependency);
    });

    const partial = DI.provide(op, new InMemoryDatabase());
    type _ = Assert<IsEqual<InferReqs<typeof partial>, LoggerDependency>>;

    // @ts-expect-error - unrelated dependency implementation cannot satisfy DatabaseDependency
    DI.provide(op, { log: () => {} });
  });

  test("DI helper types expose the requirement math", () => {
    const dbBinding = DI.singleton(DatabaseDependency, {
      query: Op(function* (_sql: string, _params: unknown[]) {
        return { id: "1" };
      }).mapErr((error): DatabaseError => error),
    });

    type Req = DatabaseDependency | LoggerDependency;
    type _EntryReq = Assert<IsEqual<UseReq<typeof dbBinding, Req>, DatabaseDependency>>;
    type _Remaining = Assert<
      IsEqual<ProvidedReq<readonly [typeof dbBinding], Req>, LoggerDependency>
    >;
    type _MetaReq = Assert<
      IsEqual<InferMetaReqs<WithDIMeta<never, DatabaseDependency>>, DatabaseDependency>
    >;
    type _Value = Assert<IsEqual<DependencyValue<typeof DatabaseDependency>, Database>>;
    type _Token = Assert<IsEqual<DependencyReq<typeof DatabaseDependency>, DatabaseDependency>>;

    expectTypeOf(DatabaseDependency).toExtend<Dependency<Database, "DatabaseDependency">>();
  });

  test("metadata propagates through fluent combinators", () => {
    const findUser = Op(function* (id: string) {
      const db = yield* DI.require(DatabaseDependency);
      return yield* db.query("user", [id]);
    });
    const log = Op(function* () {
      const logger = yield* DI.require(LoggerDependency);
      logger.log("ok");
    });

    const mapped = findUser.map((user) => user.id);
    const timed = findUser.withTimeout(1);
    const tapped = findUser("1").tap(() => log);
    const flatMapped = findUser("1").flatMap(() => log);

    expectTypeOf<InferReqs<typeof mapped>>().toEqualTypeOf<DatabaseDependency>();
    expectTypeOf<InferReqs<typeof timed>>().toEqualTypeOf<DatabaseDependency>();
    type _Tapped = Assert<IsEqual<InferReqs<typeof tapped>, DatabaseDependency | LoggerDependency>>;
    type _FlatMapped = Assert<
      IsEqual<InferReqs<typeof flatMapped>, DatabaseDependency | LoggerDependency>
    >;
  });
});
