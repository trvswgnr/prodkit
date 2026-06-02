import { NEVER, unsafeCoerce } from "@prodkit/shared/runtime";
import { describe, expectTypeOf, test } from "vitest";
import { Op } from "../../src/index.js";
import {
  CUSTOM_INSTRUCTION_META,
  withBlocking,
  type Blocking,
  type BlockingOp,
  type CustomInstruction,
  type EmptyMeta,
  type InferInstructionMeta,
  type InferOpMeta,
  type IsRunnable,
  type MergeMeta,
  type RunContext,
} from "../../src/internal/index.js";
import { type NormalizeMeta } from "../../src/core/meta.js";
import type { IsEqual, Assert } from "../support/type-utils.js";
import type { Result } from "../../src/result.js";
import type { UnhandledException } from "../../src/errors.js";
import { Policy } from "../../src/policy/index.js";

type DatabaseReq = { deps: "database" };
type LoggerReq = { deps: "logger" };
type CacheReq = { deps: "cache" };
type SpanReq = { spans: "auth" };
type DiMeta = { deps: Blocking<"database"> };
type AuthMeta = { auth: Blocking<true> };
type DiAndAuthMeta = MergeMeta<DiMeta, AuthMeta>;

class TestInstruction<T, M> implements CustomInstruction<T, M> {
  readonly [CUSTOM_INSTRUCTION_META]: M = NEVER;
  private readonly value: T;

  constructor(value: T) {
    this.value = value;
  }

  resolve(_context: RunContext): T {
    return this.value;
  }

  *[Symbol.iterator](): Generator<this, T, unknown> {
    // SAFETY: TestInstruction is a CustomInstruction and its yield type matches resolve.
    return unsafeCoerce(yield this);
  }
}

describe("metadata type contracts", () => {
  test("plain ops carry empty metadata", () => {
    const op = Op(function* () {
      return 1;
    });

    expectTypeOf(op.run()).toMatchTypeOf<Promise<unknown>>();
    type _ = Assert<IsEqual<InferOpMeta<typeof op>, EmptyMeta>>;
  });

  test("custom instructions contribute metadata on arity ops", () => {
    const op = Op(function* (_id: string) {
      return yield* new TestInstruction<number, DatabaseReq>(1);
    });

    type _ = Assert<IsEqual<InferOpMeta<typeof op>, DatabaseReq>>;
  });

  test("custom instructions contribute metadata", () => {
    const op = Op(function* () {
      return yield* new TestInstruction<number, DatabaseReq>(1);
    });

    type _OpMeta = Assert<IsEqual<InferOpMeta<typeof op>, DatabaseReq>>;
    type _ = Assert<
      IsEqual<InferInstructionMeta<TestInstruction<number, DatabaseReq>>, DatabaseReq>
    >;
  });

  test("nested yielded ops bubble metadata", () => {
    const nested = Op(function* () {
      return yield* new TestInstruction<number, DatabaseReq>(1);
    });
    const outer = Op(function* () {
      return yield* nested;
    });

    type _ = Assert<IsEqual<InferOpMeta<typeof outer>, DatabaseReq>>;
  });

  test("merge metadata unions values at shared keys", () => {
    type _ = Assert<IsEqual<MergeMeta<DatabaseReq, LoggerReq>, { deps: "database" | "logger" }>>;
    type _EmptyLeft = Assert<IsEqual<MergeMeta<EmptyMeta, DatabaseReq>, DatabaseReq>>;
    type _EmptyRight = Assert<IsEqual<MergeMeta<DatabaseReq, EmptyMeta>, DatabaseReq>>;
    type _EmptyBoth = Assert<IsEqual<MergeMeta<EmptyMeta, EmptyMeta>, EmptyMeta>>;
    type _CrossKey = Assert<
      IsEqual<MergeMeta<DatabaseReq, SpanReq>, { deps: "database"; spans: "auth" }>
    >;
  });

  test("blocking metadata merges payloads at shared keys", () => {
    type _ = Assert<
      IsEqual<
        MergeMeta<{ deps: Blocking<"database"> }, { deps: Blocking<"logger"> }>,
        { deps: Blocking<"database" | "logger"> }
      >
    >;
    type _CrossKey = Assert<IsEqual<MergeMeta<DiMeta, AuthMeta>, DiAndAuthMeta>>;
    type _StillBlocked = Assert<IsEqual<IsRunnable<DiAndAuthMeta>, false>>;
  });

  test("combinators preserve or merge metadata", () => {
    const source = Op(function* () {
      return yield* new TestInstruction<number, DatabaseReq>(1);
    });
    const observed = Op(function* () {
      return yield* new TestInstruction<string, LoggerReq>("ok");
    });
    const recovered = Op.fail("bad" as const).recover(
      (error): error is "bad" => error === "bad",
      () => observed(),
    );

    const mapped = source.map((value) => value + 1);
    const mappedErr = source.mapErr((error) => error);
    const retried = source.with(Policy.retry());
    const timed = source.with(Policy.timeout(1));
    const cancelled = source.with(Policy.cancel(new AbortController().signal));
    const released = source.with(Policy.release(() => {}));
    const entered = source.on("enter", () => {});
    const exited = source.on("exit", () => {});
    const flatMapped = source.flatMap(() => observed);
    const tapped = source.tap(() => observed());
    const tappedErr = source.tapErr(() => observed());

    type _Mapped = Assert<IsEqual<InferOpMeta<typeof mapped>, DatabaseReq>>;
    type _MappedErr = Assert<IsEqual<InferOpMeta<typeof mappedErr>, DatabaseReq>>;
    type _Retried = Assert<IsEqual<InferOpMeta<typeof retried>, DatabaseReq>>;
    type _Timed = Assert<IsEqual<InferOpMeta<typeof timed>, DatabaseReq>>;
    type _Cancelled = Assert<IsEqual<InferOpMeta<typeof cancelled>, DatabaseReq>>;
    type _Released = Assert<IsEqual<InferOpMeta<typeof released>, DatabaseReq>>;
    type _Entered = Assert<IsEqual<InferOpMeta<typeof entered>, DatabaseReq>>;
    type _Exited = Assert<IsEqual<InferOpMeta<typeof exited>, DatabaseReq>>;
    type _FlatMapped = Assert<
      IsEqual<InferOpMeta<typeof flatMapped>, { deps: "database" | "logger" }>
    >;
    type _Tapped = Assert<IsEqual<InferOpMeta<typeof tapped>, DatabaseReq>>;
    type _TappedErr = Assert<IsEqual<InferOpMeta<typeof tappedErr>, DatabaseReq>>;
    type _Recovered = Assert<IsEqual<InferOpMeta<typeof recovered>, EmptyMeta>>;

    type _ = Assert<IsEqual<MergeMeta<DatabaseReq, CacheReq>, { deps: "database" | "cache" }>>;
  });

  test("combinators merge child metadata", () => {
    const withDb = Op(function* () {
      return yield* new TestInstruction<number, DatabaseReq>(1);
    });
    const withLogger = Op(function* () {
      return yield* new TestInstruction<string, LoggerReq>("ok");
    });
    const all = Op.all([withDb, withLogger]);
    const allSettled = Op.allSettled([withDb, withLogger]);
    const anyCombined = Op.any([withDb, withLogger]);
    const race = Op.race([withDb, withLogger]);

    type _All = Assert<IsEqual<InferOpMeta<typeof all>, { deps: "database" | "logger" }>>;
    type _AllSettled = Assert<
      IsEqual<InferOpMeta<typeof allSettled>, { deps: "database" | "logger" }>
    >;
    type _Any = Assert<IsEqual<InferOpMeta<typeof anyCombined>, { deps: "database" | "logger" }>>;
    type _Race = Assert<IsEqual<InferOpMeta<typeof race>, { deps: "database" | "logger" }>>;

    const outer = Op(function* () {
      return yield* Op.all([withDb, withLogger]);
    });
    type _Outer = Assert<IsEqual<InferOpMeta<typeof outer>, { deps: "database" | "logger" }>>;
  });
});

describe("Blocking type contracts", () => {
  test("plain ops are runnable by default", () => {
    const op = Op(function* () {
      return yield* new TestInstruction<number, SpanReq>(1);
    });

    const result = op.run();

    expectTypeOf(result).toEqualTypeOf<Promise<Result<number, UnhandledException>>>();
    type _ = Assert<IsEqual<IsRunnable<InferOpMeta<typeof op>>, true>>;
  });

  test("Blocking blocks .run() until the metadata payload is satisfied", () => {
    const ready = Op(function* () {
      return 1;
    });
    const blocked = withBlocking(ready, "demo");

    type _Blocked = Assert<IsEqual<IsRunnable<InferOpMeta<typeof blocked>>, false>>;
    type _Blocking = Assert<IsEqual<InferOpMeta<typeof blocked>, { demo: Blocking<true> }>>;
    type _BlockingOp = Assert<
      IsEqual<typeof blocked, BlockingOp<number, never, [], EmptyMeta, "demo", true>>
    >;

    // @ts-expect-error - wrapped in Blocking
    blocked.run();
    expectTypeOf(ready.run()).toMatchTypeOf<Promise<unknown>>();
  });

  test("Blocking metadata blocks run without the Blocking wrapper", () => {
    const blocked = Op(function* () {
      return yield* new TestInstruction<number, DiMeta>(1);
    });

    type _ = Assert<IsEqual<IsRunnable<InferOpMeta<typeof blocked>>, false>>;

    // @ts-expect-error - blocking metadata present
    blocked.run();
  });

  test("satisfying one blocking key keeps other blocking keys blocked", () => {
    type ClearedAuth = Omit<DiAndAuthMeta, "deps">;
    type _ClearedAuth = Assert<IsEqual<ClearedAuth, { auth: Blocking<true> }>>;
    type _StillBlocked = Assert<IsEqual<IsRunnable<ClearedAuth>, false>>;
    type _FullyCleared = Assert<
      IsEqual<NormalizeMeta<Omit<DiAndAuthMeta, "deps" | "auth">>, EmptyMeta>
    >;
    type _Runnable = Assert<
      IsEqual<IsRunnable<NormalizeMeta<Omit<DiAndAuthMeta, "deps" | "auth">>>, true>
    >;
  });
});
