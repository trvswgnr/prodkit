// oxlint-disable typescript/no-explicit-any
import type { TimeoutError, UnhandledException } from "../errors.js";
import type { Err, Result } from "../result.js";
import type {
  ReleasePolicyAttachment,
  RetryPolicyAttachment,
  SignalPolicyAttachment,
  TimeoutPolicyAttachment,
} from "./policy.js";
import type { RegisterExitFinalizerInstruction, SuspendInstruction } from "./instructions.js";
import type { Op } from "../index.js";

declare const EMPTY_META: unique symbol;
declare const BLOCKING: unique symbol;
export const CUSTOM_INSTRUCTION_META = Symbol("prodkit.op.custom-instruction-meta");

/**
 * Metadata merge algebra for composed operations.
 *
 * Operations carry extension metadata on `M`. When they compose (`flatMap`, combinators,
 * yielded custom instructions), {@link MergeMeta} accumulates requirements from both sides.
 *
 * {@link EmptyMeta} is the identity element: merging with empty metadata leaves the other
 * operand unchanged.
 *
 * Per-key merge outcomes:
 * - Keys present on only one side are kept as-is.
 * - Plain values at the same key union (requirements accumulate).
 * - When either side at a key is {@link Blocking}, the merged value is `Blocking` with
 *   payloads unioned. `Blocking` takes precedence over plain values at that key.
 *
 * {@link MergeMetaObjects} merges two object shapes key-by-key. {@link MergeUnionMeta} applies
 * the same rules when a generator yields multiple custom instructions. {@link CollectBlockingPayload}
 * extracts `Blocking` payload types during union merges so blocking requirements stay branded.
 */
type MergeBlockingValue<VA, VB> =
  VA extends Blocking<infer TA>
    ? VB extends Blocking<infer TB>
      ? Blocking<TA | TB>
      : Blocking<TA>
    : VB extends Blocking<infer TB>
      ? Blocking<TB>
      : VA | VB;

type MergeMetaValue<A, B, K extends PropertyKey> = K extends keyof StripEmpty<A> &
  keyof StripEmpty<B>
  ? MergeBlockingValue<StripEmpty<A>[K], StripEmpty<B>[K]>
  : K extends keyof StripEmpty<A>
    ? StripEmpty<A>[K]
    : K extends keyof StripEmpty<B>
      ? StripEmpty<B>[K]
      : never;

type MergeMetaObjects<A, B> = NormalizeMeta<{
  [K in keyof StripEmpty<A> | keyof StripEmpty<B>]: MergeMetaValue<A, B, K>;
}>;

type UnionMetaValueAt<U, K extends PropertyKey> = U extends Record<K, infer V> ? V : never;

type CollectBlockingPayload<U, K extends PropertyKey> =
  U extends Record<K, Blocking<infer R>> ? R : never;

type MergeUnionMetaValue<U, K extends PropertyKey> = [CollectBlockingPayload<U, K>] extends [never]
  ? UnionMetaValueAt<U, K>
  : Blocking<CollectBlockingPayload<U, K>>;

type MergeUnionMeta<U> = NormalizeMeta<
  [U] extends [never]
    ? EmptyMeta
    : {
        [K in AllMetaKeys<U>]: MergeUnionMetaValue<U, K>;
      }
>;

/** Merges metadata accumulated across two composed operations. See merge algebra above. */
export type MergeMeta<A, B> =
  IsAny<A> extends true
    ? any
    : IsAny<B> extends true
      ? any
      : [A] extends [EmptyMeta]
        ? NormalizeMeta<B>
        : [B] extends [EmptyMeta]
          ? NormalizeMeta<A>
          : MergeMetaObjects<A, MergeMetaRight<B>>;

export type TrackedErr<E, Excluded = never> = E extends UnhandledException
  ? never
  : E extends TimeoutError
    ? never
    : E extends Excluded
      ? never
      : E;

export type BypassedErr<E> = E extends TimeoutError ? E : never;

export type InferOpOk<R> = R extends Op<infer T, any, [], any> ? T : Awaited<R>;

export type InferOpErr<R> = R extends Op<any, infer E, [], any> ? E : never;

export type InferOpMeta<R> =
  R extends Op<any, any, infer _A, infer M> ? NormalizeMeta<M> : EmptyMeta;

export type SetBlockingMeta<M, K extends PropertyKey, T> = NormalizeMeta<
  Simplify<StripEmpty<M> & { [P in K]: Blocking<T> }>
>;

/**
 * Runnable gating from metadata.
 *
 * Top-level {@link BaseOp.run} is available only when every metadata key is satisfied.
 * {@link HasBlocking} is true when any key still carries {@link Blocking} with a non-empty
 * payload. {@link IsRunnable} is false in that case, so `.run()` is not on the operation type.
 *
 * Extension packages block `.run()` by attaching `Blocking` to metadata keys (or via
 * `withBlocking(...)`). Callers satisfy those requirements through extension-specific runners
 * first; clearing or replacing blocking metadata is what makes `.run()` type-check again.
 */
export type IsRunnable<M> =
  IsAny<M> extends true ? true : [HasBlocking<M>] extends [true] ? false : true;

/** True when metadata still carries an unsatisfied {@link Blocking} requirement on any key. */
type HasBlocking<M> = keyof StripEmpty<M> extends never
  ? false
  : {
        [K in keyof StripEmpty<M>]: StripEmpty<M>[K] extends Blocking<infer R>
          ? [R] extends [never]
            ? false
            : true
          : false;
      }[keyof StripEmpty<M>] extends true
    ? true
    : false;

/**
 * Empty metadata; the merge identity element.
 *
 * Operations with no extension requirements use `EmptyMeta`. Merging with `EmptyMeta` leaves
 * the other operand unchanged in both directions.
 */
export type EmptyMeta = {
  readonly [EMPTY_META]: true;
};

/**
 * Branded metadata value that blocks top-level `.run()` until its payload is satisfied.
 *
 * During metadata merge, `Blocking` at a key takes precedence over plain values and unions
 * payloads with other `Blocking` values at the same key.
 */
export type Blocking<T> = { readonly [BLOCKING]: T };

/** Metadata shapes accepted on {@link Op}'s `M` parameter (writable object literals are fine). */
export type Meta<M = EmptyMeta> = M;

type IsAny<T> = 0 extends 1 & T ? true : false;
export type NormalizeMeta<M> = [M] extends [never]
  ? EmptyMeta
  : M extends EmptyMeta
    ? EmptyMeta
    : M extends object
      ? keyof M extends never
        ? EmptyMeta
        : Simplify<M>
      : M;

export type StripEmpty<M> = [M] extends [never] ? {} : M extends EmptyMeta ? {} : M;
export type Simplify<T> = T extends object ? { [K in keyof T]: T[K] } : T;
type WithoutEmptyMeta<M> = M extends EmptyMeta ? never : M;
type MergeMetaRight<B> = [WithoutEmptyMeta<B>] extends [never] ? EmptyMeta : WithoutEmptyMeta<B>;
type AllMetaKeys<U> = U extends unknown ? keyof U : never;

/**
 * Extension protocol for custom generator yield instructions.
 *
 * Implementations are detected at runtime via {@link CUSTOM_INSTRUCTION_META}
 * and executed through {@link CustomInstruction.resolve}.
 *
 * Typed failures should be surfaced by yielding {@link Err} values from
 * `[Symbol.iterator]` or from the enclosing generator; throws from `resolve`
 * surface as {@link UnhandledException}.
 */
export interface CustomInstruction<T, M = EmptyMeta> {
  readonly [CUSTOM_INSTRUCTION_META]: M;
  resolve(context: RunContext<readonly unknown[]>): T | PromiseLike<T>;
  [Symbol.iterator](): Generator<this, T, unknown>;
}

type ExtractInstructionMeta<Y> = Y extends CustomInstruction<any, infer M> ? M : never;

type NonEmptyInstructionMeta<Y> = Exclude<ExtractInstructionMeta<Y>, EmptyMeta>;

export type InferInstructionMeta<Y> = [NonEmptyInstructionMeta<Y>] extends [never]
  ? EmptyMeta
  : MergeUnionMeta<NonEmptyInstructionMeta<Y>>;

type DropUnknown<E> = unknown extends E ? never : E;
type ExtractResultErr<Y> = Y extends Err<unknown, infer E> ? DropUnknown<E> : never;

export type InferInstructionErr<Y> = ExtractResultErr<Y>;

export type AnyNullaryOp = Op<unknown, unknown, [], any>;

/**
 * Passed to {@link ExitFn} when the run unwinds.
 *
 * - `args` are the runtime inputs for this run
 * - `result` is the operation's pre-finalizer settlement result
 *   (including {@link UnhandledException} on the error channel when relevant).
 *   If a finalizer throws, `.run()` returns a new cleanup-failure result instead.
 */
export interface ExitContext<T, E, A = []> {
  readonly signal: AbortSignal;
  readonly args: A;
  readonly result: Result<T, E | UnhandledException>;
}

/** Passed to {@link EnterFn} when a run starts, before the wrapped operation body begins. */
export interface EnterContext<A = []> {
  readonly signal: AbortSignal;
  readonly args: A;
}

/** Runtime execution context threaded through internal driver/suspend boundaries. */
export interface RunContext<A = []> {
  readonly signal: AbortSignal;
  readonly args: A;
  readonly extensions: ReadonlyMap<unknown, unknown>;
}

export type EnterFn<A> = (ctx: EnterContext<A>) => unknown;
export type ExitFn<T = unknown, E = unknown, A = []> = (ctx: ExitContext<T, E, A>) => unknown;
export type LifecycleFn<T = unknown, E = unknown, A = []> = EnterFn<A> | ExitFn<T, E, A>;

/** Widened hook for {@link builders.defer} where enclosing `Op` `T`/`E` are not inferred. */
export type AnyExitFn = ExitFn<unknown, unknown, readonly unknown[]>;

export type Instruction<E, M = EmptyMeta> =
  | Err<unknown, E>
  | SuspendInstruction
  | RegisterExitFinalizerInstruction
  | CustomInstruction<unknown, M>;

export type ReleaseFn<T> = (value: T) => unknown;

/** Lifecycle channels exposed by {@link Op}. */
export type OpLifecycleHook = "enter" | "exit";

export interface BaseOp<T, E, A, M = EmptyMeta> {
  /** Type discriminant for an `Op` instance. */
  readonly _tag: "Op";

  /** Provides the operation with runtime arguments. */
  (...args: AsArgs<A>): Op<T, E, [], M>;

  /**
   * Executes the operation with runtime arguments and returns a `Result`.
   *
   * @example
   * const result = await Op.of(1).run();
   */
  run: [IsRunnable<M>] extends [false]
    ? never
    : (...args: AsArgs<A>) => Promise<Result<T, E | UnhandledException>>;
}

type ObjectNotFunction<T> = T extends object
  ? T extends (...args: never[]) => unknown
    ? never
    : T
  : never;

export type Identity<T> = T extends ObjectNotFunction<T> ? { [K in keyof T]: T[K] } & {} : T;
export type DeepIdentity<T> =
  T extends ObjectNotFunction<T> ? { [K in keyof T]: DeepIdentity<T[K]> } & {} : T;
export type RequireOne<T> = {
  [K in keyof T]: Identity<Required<Pick<T, K>> & Partial<Omit<T, K>>>;
}[keyof T];

export interface FluentOp<T, E, A, M = EmptyMeta> {
  /**
   * Attaches a built-in execution policy to the operation.
   *
   * @example
   * import * as Policy from "@prodkit/op/policy";
   * const resilient = Op.try(() => fetch("/ping")).with(Policy.retry());
   */
  // @note: keep release first so nested Policy.release(...) callbacks infer the success value type
  with(policy: ReleasePolicyAttachment<T>): Op<T, E, A, M>;
  with(policy: RetryPolicyAttachment): Op<T, E, A, M>;
  with(policy: TimeoutPolicyAttachment): Op<T, E | TimeoutError, A, M>;
  with(policy: SignalPolicyAttachment): Op<T, E, A, M>;

  /**
   * Register a handler that runs before the operation body starts.
   *
   * @example
   * const withEnter = Op.of(1).on("enter", () => console.log("start"));
   */
  on(event: "enter", initialize: EnterFn<A>): Op<T, E, A, M>;
  /**
   * Register a handler that runs after the operation settles.
   *
   * @example
   * const withExit = Op.of(1).on("exit", () => console.log("done"));
   */
  on(event: "exit", finalize: ExitFn<T, E, A>): Op<T, E, A, M>;

  /**
   * Transforms the success value while preserving args and error channel.
   *
   * @example
   * const mapped = Op.of(2).map((n) => n * 2);
   */
  map<U>(transform: (value: T) => U): Op<Awaited<U>, E, A, M>;

  /**
   * Transforms the tracked typed error channel while preserving success values.
   *
   * @example
   * const mappedError = Op.fail("x" as const).mapErr((e) => ({ code: e }));
   */
  mapErr<E2>(transform: (error: TrackedErr<E>) => E2): Op<T, E2 | BypassedErr<E>, A, M>;

  /**
   * Binds the success value into the next operation.
   *
   * @example
   * const chained = Op.of(1).flatMap((n) => Op.of(n + 1));
   */
  flatMap<R extends Op<any, any, [], any>>(
    bind: (value: T) => R,
  ): Op<InferOpOk<R>, E | InferOpErr<R>, A, MergeMeta<M, InferOpMeta<R>>>;

  /**
   * Observes successful values without changing the success payload.
   *
   * @example
   * const observed = Op.of(1).tap((n) => console.log(n));
   */
  tap<R>(observe: (value: T) => R): Op<T, E | InferOpErr<R>, A, MergeMeta<M, InferOpMeta<R>>>;

  /**
   * Observes tracked errors without changing the original success payload.
   *
   * @example
   * const observedError = Op.fail("x" as const).tapErr((e) => console.error(e));
   */
  tapErr<R>(
    observe: (error: TrackedErr<E>) => R,
  ): Op<T, TrackedErr<E> | BypassedErr<E> | InferOpErr<R>, A, MergeMeta<M, InferOpMeta<R>>>;

  /**
   * Recovers selected typed failures into a fallback value or operation.
   * Pass a type predicate such as `MyError.is` or `(error): error is MyError => MyError.is(error)`.
   *
   * @example
   * class NotFoundError extends TaggedError("NotFoundError")() {}
   * const recovered = Op.fail(new NotFoundError()).recover(NotFoundError.is, () => ({ id: "fallback" }));
   */
  recover<ECaught extends TrackedErr<E>, R>(
    predicate: (error: TrackedErr<E>) => error is ECaught,
    handler: (error: ECaught) => R,
  ): Op<
    T | InferOpOk<R>,
    TrackedErr<E, ECaught> | BypassedErr<E> | InferOpErr<R>,
    A,
    MergeMeta<M, InferOpMeta<R>>
  >;
}

export interface OpIterable<T, E, M = EmptyMeta> {
  [Symbol.iterator](): Generator<Instruction<E, M>, T, unknown>;
}

export type OpInterface<
  T,
  E,
  A,
  M = EmptyMeta,
  Yieldable extends boolean = A extends [] ? true : false,
> = BaseOp<T, E, A, M> & FluentOp<T, E, A, M> & (Yieldable extends true ? OpIterable<T, E, M> : {});

export type AsArgs<T> = T extends readonly unknown[] ? T : never;
