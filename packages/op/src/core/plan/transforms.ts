import { TimeoutError, UnhandledException } from "../../errors.js";
import { Result } from "../../result.js";
import { EMPTY_TUPLE, coerceToNullaryOp } from "../../shared.js";
import { SuspendInstruction } from "../instructions.js";
import type {
  AnyNullaryOp,
  BypassedErr,
  InferOpErr,
  InferOpMeta,
  InferOpOk,
  MergeMeta,
  TrackedErr,
} from "../types.js";
import { createPlan, getPlan, type Plan } from "./base.js";

function bindObservedOp(value: unknown): AnyNullaryOp | undefined {
  return coerceToNullaryOp(value);
}

function isRuntimeBypass(error: unknown): error is UnhandledException | TimeoutError {
  return UnhandledException.is(error) || TimeoutError.is(error);
}

export function mapPlan<T, E, U, M>(
  source: Plan<T, E, M>,
  transform: (value: T) => U,
): Plan<Awaited<U>, E, M> {
  const build = (inner: Plan<T, E, M>) => mapPlan(inner, transform);

  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      if (result.isErr()) return yield* result;

      const mapped: Awaited<U> = yield* new SuspendInstruction(() =>
        Promise.resolve(transform(result.value)),
      );

      return mapped;
    },
    {
      withRetry: (policy) => build(source.withRetry(policy)),
      withTimeout: (timeoutMs) => mapPlan(source.withTimeout(timeoutMs), transform),
      withCancel: (abortSignal) => build(source.withCancel(abortSignal)),
    },
  );
}

export function flatMapPlan<T, E, R extends AnyNullaryOp, M>(
  source: Plan<T, E, M>,
  bind: (value: T) => R,
): Plan<InferOpOk<R>, E | InferOpErr<R>, MergeMeta<M, InferOpMeta<R>>> {
  return createPlan(function* () {
    const first: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
      source.execute(context),
    );

    if (first.isErr()) return yield* first;

    const second: Result<
      InferOpOk<R>,
      InferOpErr<R> | UnhandledException
    > = yield* new SuspendInstruction((context) =>
      getPlan(bind(first.value), EMPTY_TUPLE).execute(context),
    );

    if (second.isErr()) return yield* second;
    return second.value;
  });
}

export function tapPlan<T, E, R, M>(
  source: Plan<T, E, M>,
  observe: (value: T) => R,
): Plan<T, E | InferOpErr<R>, MergeMeta<M, InferOpMeta<R>>> {
  const build = (inner: Plan<T, E, M>) => tapPlan(inner, observe);

  return createPlan(
    function* () {
      const sourceResult: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (context) => source.execute(context),
      );

      if (sourceResult.isErr()) return yield* sourceResult;

      const observed: R = yield* new SuspendInstruction(() =>
        Promise.resolve(observe(sourceResult.value)),
      );
      const observedOp: AnyNullaryOp | undefined = yield* new SuspendInstruction(() =>
        Promise.resolve(bindObservedOp(observed)),
      );

      if (!observedOp) return sourceResult.value;

      const observedResult: Result<unknown, InferOpErr<R> | UnhandledException> =
        yield* new SuspendInstruction((context) =>
          getPlan(observedOp, EMPTY_TUPLE).execute(context),
        );

      if (observedResult.isErr()) return yield* observedResult;
      return sourceResult.value;
    },
    {
      withRetry: (policy) => build(source.withRetry(policy)),
      withTimeout: (timeoutMs) => tapPlan(source.withTimeout(timeoutMs), observe),
      withCancel: (abortSignal) => build(source.withCancel(abortSignal)),
    },
  );
}

export function mapErrPlan<T, E, E2, M>(
  source: Plan<T, E, M>,
  transform: (error: TrackedErr<E>) => E2,
): Plan<T, E2 | BypassedErr<E>, M> {
  const build = (inner: Plan<T, E, M>) => mapErrPlan(inner, transform);

  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      if (result.isOk()) return result.value;

      const sourceError = result.error;
      if (isRuntimeBypass(sourceError)) return yield* result;

      const mapped: E2 = yield* new SuspendInstruction(() =>
        Promise.resolve(transform(sourceError as TrackedErr<E>)),
      );

      return yield* Result.err(mapped);
    },
    {
      withRetry: (policy) => build(source.withRetry(policy)),
      withTimeout: (timeoutMs) =>
        mapErrPlan<T, E | TimeoutError, E2, M>(source.withTimeout(timeoutMs), transform),
      withCancel: (abortSignal) => build(source.withCancel(abortSignal)),
    },
  );
}

export function tapErrPlan<T, E, R, M>(
  source: Plan<T, E, M>,
  observe: (error: TrackedErr<E>) => R,
): Plan<T, TrackedErr<E> | BypassedErr<E> | InferOpErr<R>, MergeMeta<M, InferOpMeta<R>>> {
  const build = (inner: Plan<T, E, M>) => tapErrPlan(inner, observe);

  return createPlan(
    function* () {
      const sourceResult: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (context) => source.execute(context),
      );

      if (sourceResult.isOk()) return sourceResult.value;
      const sourceError = sourceResult.error;

      if (isRuntimeBypass(sourceError)) return yield* sourceResult;

      const observed: R = yield* new SuspendInstruction(() =>
        Promise.resolve(observe(sourceError as TrackedErr<E>)),
      );
      const observedOp: AnyNullaryOp | undefined = yield* new SuspendInstruction(() =>
        Promise.resolve(bindObservedOp(observed)),
      );

      if (!observedOp) return yield* sourceResult;

      const observedResult: Result<T, InferOpErr<R> | UnhandledException> =
        yield* new SuspendInstruction((context) =>
          getPlan(observedOp, EMPTY_TUPLE).execute(context),
        );

      if (observedResult.isErr()) return yield* observedResult;
      return yield* sourceResult;
    },
    {
      withRetry: (policy) => build(source.withRetry(policy)),
      withTimeout: (timeoutMs) =>
        tapErrPlan<T, E | TimeoutError, R, M>(source.withTimeout(timeoutMs), observe),
      withCancel: (abortSignal) => build(source.withCancel(abortSignal)),
    },
  );
}

export function recoverPlan<T, E, ECaught extends TrackedErr<E>, R, M>(
  source: Plan<T, E, M>,
  predicate: (error: TrackedErr<E>) => error is ECaught,
  handler: (error: ECaught) => R,
): Plan<
  T | InferOpOk<R>,
  TrackedErr<E, ECaught> | BypassedErr<E> | InferOpErr<R>,
  MergeMeta<M, InferOpMeta<R>>
> {
  const build = (inner: Plan<T, E, M>) => recoverPlan(inner, predicate, handler);

  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      if (result.isOk()) return result.value;

      if (isRuntimeBypass(result.error)) return yield* result;

      const error = result.error;

      if (!predicate(error as TrackedErr<E>)) return yield* Result.err(error);

      const recovered: InferOpOk<R> = yield* new SuspendInstruction(() =>
        Promise.resolve(handler(error as unknown as ECaught)),
      );
      const recoveredOp: AnyNullaryOp | undefined = yield* new SuspendInstruction(() =>
        Promise.resolve(bindObservedOp(recovered)),
      );

      if (!recoveredOp) return recovered;

      const recoveredResult: Result<
        InferOpOk<R>,
        InferOpErr<R> | UnhandledException
      > = yield* new SuspendInstruction((context) =>
        getPlan(recoveredOp, EMPTY_TUPLE).execute(context),
      );

      if (recoveredResult.isErr()) return yield* recoveredResult;
      return recoveredResult.value;
    },
    {
      withRetry: (policy) => build(source.withRetry(policy)),
      withTimeout: (timeoutMs) =>
        recoverPlan<T, E | TimeoutError, ECaught, R, M>(
          source.withTimeout(timeoutMs),
          predicate,
          handler,
        ),
      withCancel: (abortSignal) => build(source.withCancel(abortSignal)),
    },
  );
}
