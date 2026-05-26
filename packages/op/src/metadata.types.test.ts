import { describe, expectTypeOf, test } from "vitest";
import {
  Needs,
  Op,
  type EmptyMeta,
  type InferInstructionMeta,
  type InferOpMeta,
  type MergeMeta,
  type NeedsOp,
} from "./index.js";
import {
  CUSTOM_INSTRUCTION_META,
  NEEDS,
  type ClearNeedsNamespace,
  type CustomInstruction,
  type IsRunnable,
  type NeedsLatchMeta,
  type RunContext,
  type SetNeedsNamespace,
} from "./internal.js";
import type { IsEqual, Assert } from "./type-test-utils.js";
import type { Result } from "./result.js";
import type { UnhandledException } from "./errors.js";

type DatabaseReq = { readonly requirements: "database" };
type LoggerReq = { readonly requirements: "logger" };
type CacheReq = { readonly requirements: "cache" };
type SpanReq = { readonly spans: "auth" };
type DiNeeds = NeedsLatchMeta<EmptyMeta, "di">;
type AuthNeeds = NeedsLatchMeta<EmptyMeta, "auth">;
type DiAndAuthNeeds = SetNeedsNamespace<SetNeedsNamespace<EmptyMeta, "di">, "auth">;

class TestInstruction<T, M> implements CustomInstruction<T, M> {
  readonly [CUSTOM_INSTRUCTION_META]: M = undefined as M;
  private readonly value: T;

  constructor(value: T) {
    this.value = value;
  }

  resolve(_context: RunContext): T {
    return this.value;
  }

  *[Symbol.iterator](): Generator<this, T, unknown> {
    return (yield this) as T;
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
    type _ = Assert<
      IsEqual<MergeMeta<DatabaseReq, LoggerReq>, { readonly requirements: "database" | "logger" }>
    >;
    type _EmptyLeft = Assert<IsEqual<MergeMeta<EmptyMeta, DatabaseReq>, DatabaseReq>>;
    type _EmptyRight = Assert<IsEqual<MergeMeta<DatabaseReq, EmptyMeta>, DatabaseReq>>;
    type _EmptyBoth = Assert<IsEqual<MergeMeta<EmptyMeta, EmptyMeta>, EmptyMeta>>;
    type _CrossKey = Assert<
      IsEqual<
        MergeMeta<DatabaseReq, SpanReq>,
        { readonly requirements: "database"; readonly spans: "auth" }
      >
    >;
  });

  test("needs metadata merges by namespace instead of unioning records", () => {
    type _ = Assert<IsEqual<MergeMeta<DiNeeds, AuthNeeds>, DiAndAuthNeeds>>;
    type _StillBlocked = Assert<IsEqual<IsRunnable<DiAndAuthNeeds>, false>>;
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
      () => observed,
    );

    const mapped = source.map((value) => value + 1);
    const mappedErr = source.mapErr((error) => error);
    const retried = source.withRetry();
    const timed = source.withTimeout(1);
    const signaled = source.withSignal(new AbortController().signal);
    const released = source.withRelease(() => {});
    const entered = source.on("enter", () => {});
    const exited = source.on("exit", () => {});
    const flatMapped = source.flatMap(() => observed);
    const tapped = source.tap(() => observed);
    const tappedErr = source.tapErr(() => observed);

    type _Mapped = Assert<IsEqual<InferOpMeta<typeof mapped>, DatabaseReq>>;
    type _MappedErr = Assert<IsEqual<InferOpMeta<typeof mappedErr>, DatabaseReq>>;
    type _Retried = Assert<IsEqual<InferOpMeta<typeof retried>, DatabaseReq>>;
    type _Timed = Assert<IsEqual<InferOpMeta<typeof timed>, DatabaseReq>>;
    type _Signaled = Assert<IsEqual<InferOpMeta<typeof signaled>, DatabaseReq>>;
    type _Released = Assert<IsEqual<InferOpMeta<typeof released>, DatabaseReq>>;
    type _Entered = Assert<IsEqual<InferOpMeta<typeof entered>, DatabaseReq>>;
    type _Exited = Assert<IsEqual<InferOpMeta<typeof exited>, DatabaseReq>>;
    type _FlatMapped = Assert<
      IsEqual<InferOpMeta<typeof flatMapped>, { readonly requirements: "database" | "logger" }>
    >;
    type _Tapped = Assert<
      IsEqual<InferOpMeta<typeof tapped>, { readonly requirements: "database" | "logger" }>
    >;
    type _TappedErr = Assert<
      IsEqual<InferOpMeta<typeof tappedErr>, { readonly requirements: "database" | "logger" }>
    >;
    type _Recovered = Assert<IsEqual<InferOpMeta<typeof recovered>, LoggerReq>>;

    type _ = Assert<
      IsEqual<MergeMeta<DatabaseReq, CacheReq>, { readonly requirements: "database" | "cache" }>
    >;
  });
});

describe("Needs type contracts", () => {
  test("plain ops are runnable by default", () => {
    const op = Op(function* () {
      return yield* new TestInstruction<number, SpanReq>(1);
    });

    const result = op.run();

    expectTypeOf(result).toEqualTypeOf<Promise<Result<number, UnhandledException>>>();
    type _ = Assert<IsEqual<IsRunnable<InferOpMeta<typeof op>>, true>>;
  });

  test("Needs blocks .run() for a namespace until that namespace is cleared", () => {
    const ready = Op(function* () {
      return 1;
    });
    const blocked = Needs(ready, "demo");

    type _Blocked = Assert<IsEqual<IsRunnable<InferOpMeta<typeof blocked>>, false>>;
    type _Needs = Assert<
      IsEqual<InferOpMeta<typeof blocked>, { readonly [NEEDS]: { readonly demo: true } }>
    >;
    type _NeedsOp = Assert<IsEqual<typeof blocked, NeedsOp<number, never, [], EmptyMeta, "demo">>>;

    // @ts-expect-error - wrapped in Needs
    blocked.run();
    expectTypeOf(ready.run()).toMatchTypeOf<Promise<unknown>>();
  });

  test("internal needs latch blocks run without Needs wrapper", () => {
    const blocked = Op(function* () {
      return yield* new TestInstruction<number, DiNeeds>(1);
    });

    type _ = Assert<IsEqual<IsRunnable<InferOpMeta<typeof blocked>>, false>>;

    // @ts-expect-error - needs latch present
    blocked.run();
  });

  test("clearing one namespace keeps other namespaces blocked", () => {
    type _ClearedDi = Assert<
      IsEqual<
        ClearNeedsNamespace<DiAndAuthNeeds, "di">,
        { readonly [NEEDS]: { readonly auth: true } }
      >
    >;
    type _StillBlocked = Assert<
      IsEqual<IsRunnable<ClearNeedsNamespace<DiAndAuthNeeds, "di">>, false>
    >;
    type _FullyCleared = Assert<
      IsEqual<ClearNeedsNamespace<DiAndAuthNeeds, "di" | "auth">, EmptyMeta>
    >;
    type _Runnable = Assert<
      IsEqual<IsRunnable<ClearNeedsNamespace<DiAndAuthNeeds, "di" | "auth">>, true>
    >;
  });
});
