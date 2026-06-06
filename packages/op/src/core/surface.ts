// oxlint-disable typescript/no-explicit-any
import type { TimeoutError, UnhandledException } from "../errors.js";
import type { Result } from "../result.js";
import type { OpPolicy, OpPolicyInput } from "../policy/types.js";
import type { HKT } from "../hkt.js";
import type { Op } from "../index.js";
import type { Instruction } from "../execution/instructions.js";
import type { EmptyMeta, IsRunnable, MergeMeta, NormalizeMeta } from "./metadata.js";
import type { EnterFn, ExitFn } from "./lifecycle.js";

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

export type AnyNullaryOp = Op<any, any, [], any>;

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

export interface FluentOp<T, E, A, M = EmptyMeta> {
  /**
   * Attaches an execution policy to the operation.
   *
   * @example
   * import { Policy } from "@prodkit/op/policy";
   * const resilient = Op.try(() => fetch("/ping")).with(Policy.retry());
   */
  with<F extends HKT>(
    policy: OpPolicy<OpPolicyInput<T, E, AsArgs<A>, M>, F>,
  ): HKT.Apply<F, [T, E, AsArgs<A>, M]>;

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
  flatMap<R extends AnyNullaryOp>(
    bind: (value: T) => R,
  ): Op<InferOpOk<R>, E | InferOpErr<R>, A, MergeMeta<M, InferOpMeta<R>>>;

  /**
   * Observes successful values without changing the success payload.
   *
   * @example
   * const observed = Op.of(1).tap((n) => console.log(n));
   */
  tap<R>(observe: (value: T) => R): Op<T, E, A, M>;

  /**
   * Observes tracked errors without changing the original success payload.
   *
   * @example
   * const observedError = Op.fail("x" as const).tapErr((e) => console.error(e));
   */
  tapErr<R>(observe: (error: TrackedErr<E>) => R): Op<T, TrackedErr<E> | BypassedErr<E>, A, M>;

  /**
   * Recovers selected typed failures into a fallback value.
   * Pass a type predicate such as `MyError.is` or `(error): error is MyError => MyError.is(error)`.
   *
   * @example
   * class NotFoundError extends TaggedError("NotFoundError")() {}
   * const recovered = Op.fail(new NotFoundError()).recover(NotFoundError.is, () => ({ id: "fallback" }));
   */
  recover<ECaught extends TrackedErr<E>, R>(
    predicate: (error: TrackedErr<E>) => error is ECaught,
    handler: (error: ECaught) => R,
  ): Op<T | Awaited<R>, TrackedErr<E, ECaught> | BypassedErr<E>, A, M>;
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
