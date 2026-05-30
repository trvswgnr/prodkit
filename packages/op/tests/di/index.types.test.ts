import { describe, expectTypeOf, test } from "vitest";
import { Op, type EmptyMeta, type InferOpMeta, type Blocking } from "../../src/index.js";
import { type IsRunnable } from "../../src/core/types.js";
import { DI, type Dependency } from "../../src/di/index.js";
import type {
  DependencyReq,
  DependencyValue,
  InferMetaReqs,
  InferReqs,
  ProvidedReq,
  UseReq,
  WithDIMeta,
} from "../../src/di/internal.js";
import * as Policy from "../../src/policy/index.js";

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
  test("plain non-DI ops have no deps", () => {
    const op = Op(function* () {
      return 1;
    });

    type _ = Assert<IsEqual<InferReqs<typeof op>, never>>;
  });

  test("DI.inject contributes deps to plain Op", () => {
    const op = Op(function* () {
      const db = yield* DI.inject(DatabaseDependency);
      return yield* db.query("user", ["1"]);
    });

    type _ = Assert<IsEqual<InferReqs<typeof op>, DatabaseDependency>>;
    type Meta = InferOpMeta<typeof op>;
    type _Req = Assert<IsEqual<Meta["deps"], Blocking<DatabaseDependency>>>;
    type _Annotated =
      typeof op extends Op<User, DatabaseError, [], { deps: Blocking<DatabaseDependency> }>
        ? true
        : false;
    type _Annotation = Assert<IsEqual<_Annotated, true>>;
  });

  test("DI.inject contributes metadata on arity ops", () => {
    const findUser = Op(function* (id: string) {
      const db = yield* DI.inject(DatabaseDependency);
      return yield* db.query("user", [id]);
    });

    type _Reqs = Assert<IsEqual<InferReqs<typeof findUser>, DatabaseDependency>>;
    type Meta = InferOpMeta<typeof findUser>;
    type _Req = Assert<IsEqual<Meta["deps"], Blocking<DatabaseDependency>>>;
  });

  test("multiple and nested deps infer as a union", () => {
    const findUser = Op(function* (id: string) {
      const db = yield* DI.inject(DatabaseDependency);
      return yield* db.query("user", [id]);
    });
    const greet = Op(function* (id: string) {
      const logger = yield* DI.inject(LoggerDependency);
      const user = yield* findUser(id);
      logger.log(user.id);
      return user.id;
    });

    expectTypeOf<InferReqs<typeof greet>>().toEqualTypeOf<DatabaseDependency | LoggerDependency>();
  });

  test("provisioning removes only satisfied deps", () => {
    const op = Op(function* () {
      yield* DI.inject(DatabaseDependency);
      yield* DI.inject(LoggerDependency);
    });
    const db = {
      query: Op(function* (_sql: string, _params: unknown[]) {
        return { id: "1" };
      }).mapErr((error): DatabaseError => error),
    } satisfies Database;

    const partial = DI.provide(op, DI.singleton(DatabaseDependency, db));
    const full = DI.provide(
      partial,
      DI.scoped(LoggerDependency, (_signal) => ({ log: () => {} })),
    );

    type _PartialReqs = Assert<IsEqual<InferReqs<typeof partial>, LoggerDependency>>;
    type _PartialMeta = Assert<
      IsEqual<InferOpMeta<typeof partial>["deps"], Blocking<LoggerDependency>>
    >;
    type _FullReqs = Assert<IsEqual<InferReqs<typeof full>, never>>;
  });

  test("direct implementations satisfy matching dependency tokens only", () => {
    class InMemoryDatabase extends DatabaseDependency implements Database {
      query = Op(function* (_sql: string, params: unknown[]) {
        return { id: String(params[0]) };
      }).mapErr((error): DatabaseError => error);
    }

    const op = Op(function* () {
      yield* DI.inject(DatabaseDependency);
      yield* DI.inject(LoggerDependency);
    });

    const partial = DI.provide(op, new InMemoryDatabase());
    type _ = Assert<IsEqual<InferReqs<typeof partial>, LoggerDependency>>;

    // @ts-expect-error - unrelated dependency implementation cannot satisfy DatabaseDependency
    DI.provide(op, { log: () => {} });
  });

  test("provide rejects bindings for dependencies the op does not require", () => {
    const dbOnly = Op(function* () {
      yield* DI.inject(DatabaseDependency);
    });
    const db = {
      query: Op(function* (_sql: string, _params: unknown[]) {
        return { id: "1" };
      }).mapErr((error): DatabaseError => error),
    } satisfies Database;

    DI.provide(
      dbOnly,
      // @ts-expect-error - LoggerDependency is not required by this op
      DI.scoped(LoggerDependency, (_signal) => ({ log: () => {} })),
    );

    const satisfied = DI.provide(dbOnly, DI.singleton(DatabaseDependency, db));
    type _Satisfied = Assert<IsEqual<InferReqs<typeof satisfied>, never>>;

    DI.provide(
      satisfied,
      // @ts-expect-error - op has no remaining deps
      DI.scoped(LoggerDependency, (_signal) => ({ log: () => {} })),
    );
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
      const db = yield* DI.inject(DatabaseDependency);
      return yield* db.query("user", [id]);
    });
    const log = Op(function* () {
      const logger = yield* DI.inject(LoggerDependency);
      logger.log("ok");
    });

    const mapped = findUser.map((user) => user.id);
    const timed = findUser.with(Policy.timeout(1));
    const tapped = findUser("1").tap(() => log);
    const flatMapped = findUser("1").flatMap(() => log);

    expectTypeOf<InferReqs<typeof mapped>>().toEqualTypeOf<DatabaseDependency>();
    expectTypeOf<InferReqs<typeof timed>>().toEqualTypeOf<DatabaseDependency>();
    type _TappedReqs = InferReqs<typeof tapped>;
    type _Tapped = Assert<IsEqual<InferReqs<typeof tapped>, DatabaseDependency | LoggerDependency>>;
    type _FlatMapped = Assert<
      IsEqual<InferReqs<typeof flatMapped>, DatabaseDependency | LoggerDependency>
    >;
  });

  test("unprovisioned ops cannot call .run()", () => {
    const op = Op(function* () {
      yield* DI.inject(DatabaseDependency);
    });

    // @ts-expect-error - not provisioned
    op.run();
  });

  test("partially provisioned ops cannot call .run()", () => {
    const op = Op(function* () {
      yield* DI.inject(DatabaseDependency);
      yield* DI.inject(LoggerDependency);
    });
    const db = {
      query: Op(function* (_sql: string, _params: unknown[]) {
        return { id: "1" };
      }).mapErr((error): DatabaseError => error),
    } satisfies Database;

    const partial = DI.provide(op, DI.singleton(DatabaseDependency, db));

    // @ts-expect-error - deps remain
    partial.run();
  });

  test("fully provisioned ops can call .run()", () => {
    const op = Op(function* () {
      yield* DI.inject(DatabaseDependency);
    });
    const db = {
      query: Op(function* (_sql: string, _params: unknown[]) {
        return { id: "1" };
      }).mapErr((error): DatabaseError => error),
    } satisfies Database;

    const runnable = DI.provide(op, DI.singleton(DatabaseDependency, db));

    expectTypeOf(runnable.run).toBeFunction();
    type _ = Assert<IsEqual<InferReqs<typeof runnable>, never>>;
  });

  test("Op.all child dependency requirements bubble to parent provision sites", () => {
    const db = {
      query: Op(function* (_sql: string, _params: unknown[]) {
        return { id: "1" };
      }).mapErr((error): DatabaseError => error),
    } satisfies Database;

    const op = Op(function* () {
      yield* Op.all([
        Op(function* () {
          yield* DI.inject(DatabaseDependency);
        }),
        Op(function* () {
          yield* DI.inject(DatabaseDependency);
        }),
      ]);
    });

    type _Reqs = Assert<IsEqual<InferReqs<typeof op>, DatabaseDependency>>;

    const runnable = DI.provide(op, DI.singleton(DatabaseDependency, db));
    type _ = Assert<IsEqual<InferReqs<typeof runnable>, never>>;
  });

  test("full DI provision clears deps while other blocking keys remain", () => {
    type WithAuth = WithDIMeta<EmptyMeta, DatabaseDependency> & { auth: Blocking<true> };
    type _StillBlocked = Assert<IsEqual<IsRunnable<WithAuth>, false>>;

    type ClearedReqs = Omit<WithAuth, "deps">;
    type _AuthRemains = Assert<IsEqual<ClearedReqs["auth"], Blocking<true>>>;
    type _RunnableAfterAuthOnly = Assert<IsEqual<IsRunnable<ClearedReqs>, false>>;
    type _DiOnly = Assert<IsEqual<WithDIMeta<EmptyMeta, never>, EmptyMeta>>;
  });
});
