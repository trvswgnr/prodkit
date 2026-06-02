import { TimeoutError, UnhandledException } from "../../errors.js";
import { Result } from "../../result.js";
import { EMPTY_TUPLE } from "../../shared.js";
import { SuspendInstruction, SuspendResume } from "../instructions.js";
import type {
  AnyNullaryOp,
  BypassedErr,
  InferOpErr,
  InferOpMeta,
  InferOpOk,
  TrackedErr,
} from "./surface.js";
import type { MergeMeta } from "../meta.js";
import { createPlan, getPlan, rewriteUnaryPlan, type Plan } from "./base.js";

function isRuntimeBypass(error: unknown): error is UnhandledException | TimeoutError {
  return UnhandledException.is(error) || TimeoutError.is(error);
}

export function mapPlan<T, E, U, M>(
  source: Plan<T, E, M>,
  transform: (value: T) => U,
): Plan<Awaited<U>, E, M> {
  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (context) => source.execute(context),
        SuspendResume.passThrough,
      );

      if (result.isErr()) return yield* result;

      const mapped: Awaited<U> = yield* new SuspendInstruction(
        () => Promise.resolve(transform(result.value)),
        SuspendResume.passThrough,
      );

      return mapped;
    },
    {
      rewrite: (_self, rewriter) =>
        rewriteUnaryPlan(rewriter, source, (inner) => mapPlan(inner, transform)),
    },
  );
}

/**
 * No `rewrite` override: policies wrap the whole `flatMap` node via `rewriter.apply` so retry
 * re-executes source and bind together (see `fluent.test.ts`, flatMap + Policy.retry).
 */
export function flatMapPlan<T, E, R extends AnyNullaryOp, M>(
  source: Plan<T, E, M>,
  bind: (value: T) => R,
): Plan<InferOpOk<R>, E | InferOpErr<R>, MergeMeta<M, InferOpMeta<R>>> {
  return createPlan(function* () {
    const first: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
      (context) => source.execute(context),
      SuspendResume.passThrough,
    );

    if (first.isErr()) return yield* first;

    const second: Result<
      InferOpOk<R>,
      InferOpErr<R> | UnhandledException
    > = yield* new SuspendInstruction(
      (context) => getPlan(bind(first.value), EMPTY_TUPLE).execute(context),
      SuspendResume.passThrough,
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
        SuspendResume.passThrough,
      );

      if (sourceResult.isErr()) return yield* sourceResult;

      yield* new SuspendInstruction(
        () => Promise.resolve(observe(sourceResult.value)),
        SuspendResume.passThrough,
      );
      return sourceResult.value;
    },
    {
      rewrite: (_self, rewriter) =>
        rewriteUnaryPlan(rewriter, source, (inner) => tapPlan(inner, observe)),
    },
  );
}

export function mapErrPlan<T, E, E2, M>(
  source: Plan<T, E, M>,
  transform: (error: TrackedErr<E>) => E2,
): Plan<T, E2 | BypassedErr<E>, M> {
  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (context) => source.execute(context),
        SuspendResume.passThrough,
      );

      if (result.isOk()) return result.value;

      const sourceError = result.error;
      if (isRuntimeBypass(sourceError)) return yield* result;

      const mapped: E2 = yield* new SuspendInstruction(
        () => Promise.resolve(transform(sourceError as TrackedErr<E>)),
        SuspendResume.passThrough,
      );

      return yield* Result.err(mapped);
    },
    {
      rewrite: (_self, rewriter) =>
        rewriteUnaryPlan(rewriter, source, (inner) => mapErrPlan(inner, transform)),
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
        SuspendResume.passThrough,
      );

      if (sourceResult.isOk()) return sourceResult.value;
      const sourceError = sourceResult.error;

      if (isRuntimeBypass(sourceError)) return yield* sourceResult;

      yield* new SuspendInstruction(
        () => Promise.resolve(observe(sourceError as TrackedErr<E>)),
        SuspendResume.passThrough,
      );
      return yield* sourceResult;
    },
    {
      rewrite: (_self, rewriter) =>
        rewriteUnaryPlan(rewriter, source, (inner) => tapErrPlan(inner, observe)),
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
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (context) => source.execute(context),
        SuspendResume.passThrough,
      );

      if (result.isOk()) return result.value;

      if (isRuntimeBypass(result.error)) return yield* result;

      const error = result.error;

      if (!predicate(error as TrackedErr<E>)) return yield* Result.err(error);

      const recovered: Awaited<R> = yield* new SuspendInstruction(
        () => Promise.resolve(handler(error as unknown as ECaught)),
        SuspendResume.passThrough,
      );
      return recovered;
    },
    {
      rewrite: (_self, rewriter) =>
        rewriteUnaryPlan(rewriter, source, (inner) => recoverPlan(inner, predicate, handler)),
    },
  );
}
