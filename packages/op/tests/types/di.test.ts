import { describe, expectTypeOf, test } from "vitest";
import { Op } from "../../src/index.js";
import { type Blocking, type EmptyMeta, type InferOpMeta } from "../../src/internal/index.js";
import { type IsRunnable } from "../../src/core/meta.js";
import { DI, type Dependency } from "../../src/di/index.js";
import type {
  Deps,
  DependencyValue,
  RequiredDepsOfMeta,
  RequiredDeps,
  RemainingRequiredDeps,
  DepsOf,
  WithDIMeta,
} from "../../src/di/internal.js";
import { Policy } from "../../src/policy/index.js";
import type { Assert, IsEqual } from "../support/type-utils.js";

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

describe("DI type inference", () => {
  test("plain non-DI ops have no deps", () => {
    const op = Op(function* () {
      return 1;
    });

    type _ = Assert<IsEqual<RequiredDeps<typeof op>, never>>;
  });

  test("DI.inject contributes deps to plain Op", () => {
    const op = Op(function* () {
      const db = yield* DI.inject(DatabaseDependency);
      return yield* db.query("user", ["1"]);
    });

    type _ = Assert<IsEqual<RequiredDeps<typeof op>, DatabaseDependency>>;
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

    type _Reqs = Assert<IsEqual<RequiredDeps<typeof findUser>, DatabaseDependency>>;
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

    expectTypeOf<RequiredDeps<typeof greet>>().toEqualTypeOf<
      DatabaseDependency | LoggerDependency
    >();
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

    const partial = DI.provide(op, [DI.singleton(DatabaseDependency, db)]);
    const full = DI.provide(partial, [
      DI.scoped(LoggerDependency, (_signal) => ({ log: () => {} })),
    ]);

    type _PartialReqs = Assert<IsEqual<RequiredDeps<typeof partial>, LoggerDependency>>;
    type _PartialMeta = Assert<
      IsEqual<InferOpMeta<typeof partial>["deps"], Blocking<LoggerDependency>>
    >;
    type _FullReqs = Assert<IsEqual<RequiredDeps<typeof full>, never>>;
  });

  test("provide rejects non-binding entries", () => {
    const op = Op(function* () {
      yield* DI.inject(DatabaseDependency);
    });

    // @ts-expect-error - bindings tuple must contain DI.singleton or DI.scoped bindings
    DI.provide(op, [{ log: () => {} }]);
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
      [DI.scoped(LoggerDependency, (_signal) => ({ log: () => {} }))],
    );

    const satisfied = DI.provide(dbOnly, [DI.singleton(DatabaseDependency, db)]);
    type _Satisfied = Assert<IsEqual<RequiredDeps<typeof satisfied>, never>>;

    DI.provide(
      satisfied,
      // @ts-expect-error - op has no remaining deps
      [DI.scoped(LoggerDependency, (_signal) => ({ log: () => {} }))],
    );
  });

  test("DI helper types expose the requirement math", () => {
    const dbBinding = DI.singleton(DatabaseDependency, {
      query: Op(function* (_sql: string, _params: unknown[]) {
        return { id: "1" };
      }).mapErr((error): DatabaseError => error),
    });

    type Req = DatabaseDependency | LoggerDependency;
    type _EntryReq = Assert<IsEqual<DepsOf<typeof dbBinding>, DatabaseDependency>>;
    type _Remaining = Assert<
      IsEqual<RemainingRequiredDeps<readonly [typeof dbBinding], Req>, LoggerDependency>
    >;
    type _MetaReq = Assert<
      IsEqual<RequiredDepsOfMeta<WithDIMeta<never, DatabaseDependency>>, DatabaseDependency>
    >;
    type _Value = Assert<IsEqual<DependencyValue<typeof DatabaseDependency>, Database>>;
    type _Token = Assert<IsEqual<Deps<typeof DatabaseDependency>, DatabaseDependency>>;

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
    const tapped = findUser("1").tap(() => log());
    const flatMapped = findUser("1").flatMap(() => log);

    expectTypeOf<RequiredDeps<typeof mapped>>().toEqualTypeOf<DatabaseDependency>();
    expectTypeOf<RequiredDeps<typeof timed>>().toEqualTypeOf<DatabaseDependency>();
    type _TappedReqs = RequiredDeps<typeof tapped>;
    type _Tapped = Assert<IsEqual<RequiredDeps<typeof tapped>, DatabaseDependency>>;
    type _FlatMapped = Assert<
      IsEqual<RequiredDeps<typeof flatMapped>, DatabaseDependency | LoggerDependency>
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

    const partial = DI.provide(op, [DI.singleton(DatabaseDependency, db)]);

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

    const runnable = DI.provide(op, [DI.singleton(DatabaseDependency, db)]);

    expectTypeOf(runnable.run).toBeFunction();
    type _ = Assert<IsEqual<RequiredDeps<typeof runnable>, never>>;
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

    type _Reqs = Assert<IsEqual<RequiredDeps<typeof op>, DatabaseDependency>>;

    const runnable = DI.provide(op, [DI.singleton(DatabaseDependency, db)]);
    type _ = Assert<IsEqual<RequiredDeps<typeof runnable>, never>>;
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
