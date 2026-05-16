import type { TimeoutError, UnhandledException } from "../errors.js";
import type { Err, Result } from "../result.js";
import type { RetryPolicy } from "../policies.js";
import type { RegisterExitFinalizerInstruction, SuspendInstruction } from "./instructions.js";
import type { Op } from "../index.js";

export type TrackedErr<E, Excluded = never> = E extends UnhandledException
  ? never
  : E extends Excluded
    ? never
    : E;

export type InferOpOk<R> = R extends Op<infer T, unknown, []> ? T : Awaited<R>;

export type InferOpErr<R> = R extends Op<unknown, infer E, []> ? E : never;

/**
 * Passed to {@link ExitFn} when the run unwinds.
 *
 * - `args` are the runtime inputs for this run
 * - `result` is the operation's pre-finalizer settlement result
 *   (including {@link UnhandledException} on the error channel when relevant).
 *   If a finalizer throws, `.run()` returns a new cleanup-failure result instead.
 */
export interface ExitContext<T, E, A extends readonly unknown[] = []> {
  readonly signal: AbortSignal;
  readonly args: A;
  readonly result: Result<T, E | UnhandledException>;
}

/** Passed to {@link EnterFn} when a run starts, before the wrapped operation body begins. */
export interface EnterContext<A extends readonly unknown[] = []> {
  readonly signal: AbortSignal;
  readonly args: A;
}

/** Runtime execution context threaded through internal driver/suspend boundaries. */
export interface RunContext<A extends readonly unknown[] = readonly unknown[]> {
  readonly signal: AbortSignal;
  readonly args: A;
}

export type EnterFn<A extends readonly unknown[] = []> = (ctx: EnterContext<A>) => unknown;
export type ExitFn<T = unknown, E = unknown, A extends readonly unknown[] = []> = (
  ctx: ExitContext<T, E, A>,
) => unknown;
export type LifecycleFn<T = unknown, E = unknown, A extends readonly unknown[] = []> =
  | EnterFn<A>
  | ExitFn<T, E, A>;

/** Widened hook for {@link builders.defer} where enclosing `Op` `T`/`E` are not inferred. */
export type AnyExitFn = ExitFn<unknown, unknown, readonly unknown[]>;

export type Instruction<E> =
  | Err<unknown, E>
  | SuspendInstruction
  | RegisterExitFinalizerInstruction;

export type ReleaseFn<T> = (value: T) => unknown;

/** Lifecycle channels exposed by {@link Op}. */
export type OpLifecycleHook = "enter" | "exit";

export type WithPredicateMethod<E> = { is: (value: unknown) => value is E };

export interface BaseOp<T, E, A extends readonly unknown[]> {
  /** Type discriminant for an `Op` instance. */
  readonly _tag: "Op";

  /** Provides the operation with runtime arguments. */
  (...args: A): Op<T, E, []>;

  /**
   * Executes the operation with runtime arguments and returns a `Result`.
   *
   * @example
   * const result = await Op.of(1).run();
   */
  run(...args: A): Promise<Result<T, E | UnhandledException>>;
}

export type Identity<T> =
  T extends Record<PropertyKey, unknown> ? { [K in keyof T]: T[K] } & {} : T;
export type RequireOne<T> = {
  [K in keyof T]: Identity<Required<Pick<T, K>> & Partial<Omit<T, K>>>;
}[keyof T];

export interface FluentOp<T, E, A extends readonly unknown[], Yieldable extends boolean> {
  /**
   * Wraps the operation in retry policy logic.
   *
   * @example
   * const resilient = Op.try(() => fetch("/ping")).withRetry();
   */
  withRetry(policy?: RequireOne<RetryPolicy>): Op<T, E, A, Yieldable>;

  /**
   * Applies a timeout budget in milliseconds to the wrapped operation.
   *
   * @example
   * const bounded = Op.try(() => fetch("/slow")).withTimeout(1000);
   */
  withTimeout(timeoutMs: number): Op<T, E | TimeoutError, A, Yieldable>;

  /**
   * Binds an external abort signal to the wrapped operation run.
   *
   * @example
   * const linked = Op.of(1).withSignal(new AbortController().signal);
   */
  withSignal(signal: AbortSignal): Op<T, E, A, Yieldable>;

  /**
   * Registers release logic that runs after a successful value is produced.
   *
   * @example
   * const managed = Op.of({ close() {} }).withRelease((r) => r.close());
   */
  withRelease(release: ReleaseFn<T>): Op<T, E, A, Yieldable>;

  /**
   * Register a handler that runs before the operation body starts.
   *
   * @example
   * const withEnter = Op.of(1).on("enter", () => console.log("start"));
   */
  on(event: "enter", initialize: EnterFn<A>): Op<T, E, A, Yieldable>;
  /**
   * Register a handler that runs after the operation settles.
   *
   * @example
   * const withExit = Op.of(1).on("exit", () => console.log("done"));
   */
  on(event: "exit", finalize: ExitFn<T, E, A>): Op<T, E, A, Yieldable>;

  /**
   * Transforms the success value while preserving args and error channel.
   *
   * @example
   * const mapped = Op.of(2).map((n) => n * 2);
   */
  map<U>(transform: (value: T) => U): Op<Awaited<U>, E, A, Yieldable>;

  /**
   * Transforms the tracked typed error channel while preserving success values.
   *
   * @example
   * const mappedError = Op.fail("x" as const).mapErr((e) => ({ code: e }));
   */
  mapErr<E2>(transform: (error: TrackedErr<E>) => E2): Op<T, E2, A, Yieldable>;

  /**
   * Binds the success value into the next operation.
   *
   * @example
   * const chained = Op.of(1).flatMap((n) => Op.of(n + 1));
   */
  flatMap<U, E2>(bind: (value: T) => Op<U, E2, []>): Op<U, E | E2, A, Yieldable>;

  /**
   * Observes successful values without changing the success payload.
   *
   * @example
   * const observed = Op.of(1).tap((n) => console.log(n));
   */
  tap<R>(observe: (value: T) => R): Op<T, E | InferOpErr<R>, A, Yieldable>;

  /**
   * Observes tracked errors without changing the original success payload.
   *
   * @example
   * const observedError = Op.fail("x" as const).tapErr((e) => console.error(e));
   */
  tapErr<R>(
    observe: (error: TrackedErr<E>) => R,
  ): Op<T, TrackedErr<E> | InferOpErr<R>, A, Yieldable>;

  /**
   * Recovers selected typed failures into a fallback value or operation.
   *
   * @example
   * const recovered = Op.fail("x" as const).recover((e): e is "x" => e === "x", () => 1);
   */
  recover<ECaught extends TrackedErr<E>, R>(
    predicate: (error: TrackedErr<E>) => error is ECaught,
    handler: (error: ECaught) => R,
  ): Op<T | InferOpOk<R>, TrackedErr<E, ECaught> | InferOpErr<R>, A, Yieldable>;
  /**
   * Recovers typed failures selected by a tagged predicate method.
   *
   * @example
   * const recovered = Op.fail({ is: (v: unknown): v is string => typeof v === "string" }).recover(
   *   { is: (v: unknown): v is string => typeof v === "string" },
   *   () => 1,
   * );
   */
  recover<ECaught extends TrackedErr<E>, R>(
    predicate: WithPredicateMethod<TrackedErr<ECaught>>,
    handler: (error: ECaught) => R,
  ): Op<T | InferOpOk<R>, TrackedErr<E, ECaught> | InferOpErr<R>, A, Yieldable>;
  /**
   * Recovers failures selected by a boolean predicate over the error value.
   *
   * @example
   * const recovered = Op.fail("x" as const).recover((e) => e === "x", () => 1);
   */
  recover<R>(
    predicate: (error: TrackedErr<E>) => boolean,
    handler: (error: TrackedErr<E>) => R,
  ): Op<T | InferOpOk<R>, TrackedErr<E> | InferOpErr<R>, A, Yieldable>;
}

export interface OpIterable<T, E> {
  [Symbol.iterator](): Generator<Instruction<E>, T, unknown>;
}

export type OpInterface<
  T,
  E,
  A extends readonly unknown[],
  Yieldable extends boolean = A extends [] ? true : false,
> = BaseOp<T, E, A> &
  FluentOp<T, E, A, Yieldable> &
  (Yieldable extends true ? OpIterable<T, E> : {});

export interface OpHooks<T, E, TInner = unknown, EInner = unknown> {
  /** Inner op to push policy wrappers to (when present with `rebuild`). */
  inner?: Op<TInner, EInner, []>;
  /** Rebuild this operator around a new inner op for push-through policy behavior. */
  rebuild?: (newInner: Op<TInner, EInner, []>) => Op<T, E, []>;
  /** Optional timeout-specific rebuild for error-channel widening edge cases. */
  rebuildForTimeout?: (
    newInner: Op<TInner, EInner | TimeoutError, []>,
  ) => Op<T, E | TimeoutError, []>;
  withRelease: (release: ReleaseFn<T>) => Op<T, E, []>;
  /** Backs public `.on("enter", fn)` on ops built from these hooks. */
  registerEnterInitialize: (initialize: EnterFn<[]>) => Op<T, E, []>;
  /** Backs public `.on("exit", fn)` on ops built from these hooks. */
  registerExitFinalize: (finalize: ExitFn<T, E, []>) => Op<T, E, []>;
}
