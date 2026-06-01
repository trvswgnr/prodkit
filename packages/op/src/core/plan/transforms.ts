import { TimeoutError, UnhandledException } from "../../errors.js";
import { Result } from "../../result.js";
import { EMPTY_TUPLE } from "../../shared.js";
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

function isRuntimeBypass(error: unknown): error is UnhandledException | TimeoutError {
  return UnhandledException.is(error) || TimeoutError.is(error);
}

export function mapPlan<T, E, U, M>(
  source: Plan<T, E, M>,
  transform: (value: T) => U,
): Plan<Awaited<U>, E, M> {
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
      rewrite: (self, rewriter) => rewriter.map?.(source, transform) ?? rewriter.apply(self),
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
): Plan<T, E, M> {
  return createPlan(
    function* () {
      const sourceResult: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (context) => source.execute(context),
      );

      if (sourceResult.isErr()) return yield* sourceResult;

      yield* new SuspendInstruction(() => Promise.resolve(observe(sourceResult.value)));
      return sourceResult.value;
    },
    {
      rewrite: (self, rewriter) => rewriter.tap?.(source, observe) ?? rewriter.apply(self),
    },
  );
}

export function mapErrPlan<T, E, E2, M>(
  source: Plan<T, E, M>,
  transform: (error: TrackedErr<E>) => E2,
): Plan<T, E2 | BypassedErr<E>, M> {
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
      rewrite: (self, rewriter) => rewriter.mapErr?.(source, transform) ?? rewriter.apply(self),
    },
  );
}

export function tapErrPlan<T, E, R, M>(
  source: Plan<T, E, M>,
  observe: (error: TrackedErr<E>) => R,
): Plan<T, TrackedErr<E> | BypassedErr<E>, M> {
  return createPlan(
    function* () {
      const sourceResult: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (context) => source.execute(context),
      );

      if (sourceResult.isOk()) return sourceResult.value;
      const sourceError = sourceResult.error;

      if (isRuntimeBypass(sourceError)) return yield* sourceResult;

      yield* new SuspendInstruction(() => Promise.resolve(observe(sourceError as TrackedErr<E>)));
      return yield* sourceResult;
    },
    {
      rewrite: (self, rewriter) => rewriter.tapErr?.(source, observe) ?? rewriter.apply(self),
    },
  );
}

export function recoverPlan<T, E, ECaught extends TrackedErr<E>, R, M>(
  source: Plan<T, E, M>,
  predicate: (error: TrackedErr<E>) => error is ECaught,
  handler: (error: ECaught) => R,
): Plan<T | Awaited<R>, TrackedErr<E, ECaught> | BypassedErr<E>, M> {
  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      if (result.isOk()) return result.value;

      if (isRuntimeBypass(result.error)) return yield* result;

      const error = result.error;

      if (!predicate(error as TrackedErr<E>)) return yield* Result.err(error);

      const recovered: Awaited<R> = yield* new SuspendInstruction(() =>
        Promise.resolve(handler(error as unknown as ECaught)),
      );
      return recovered;
    },
    {
      rewrite: (self, rewriter) =>
        rewriter.recover?.(source, predicate, handler) ?? rewriter.apply(self),
    },
  );
}
