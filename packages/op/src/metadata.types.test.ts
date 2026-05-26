import { describe, expectTypeOf, test } from "vitest";
import {
  Op,
  type EmptyMeta,
  type InferInstructionMeta,
  type InferOpMeta,
  type MergeMeta,
} from "./index.js";
import { CUSTOM_INSTRUCTION_META, type CustomInstruction, type RunContext } from "./core/types.js";
import type { IsEqual, Assert } from "./type-test-utils.js";

type DatabaseReq = { readonly requirements: "database" };
type LoggerReq = { readonly requirements: "logger" };
type CacheReq = { readonly requirements: "cache" };
type SpanReq = { readonly spans: "auth" };

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
