import { unsafeCoerce } from "@prodkit/shared/runtime";
import { TimeoutError, UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { SuspendInstruction } from "../execution/instructions.js";
import { Settlement } from "../execution/settlement.js";
import type {
  AnyNullaryOp,
  BypassedErr,
  InferOpErr,
  InferOpMeta,
  InferOpOk,
  TrackedErr,
} from "../core/surface.js";
import type { MergeMeta } from "../core/metadata.js";
import { getPlan } from "./bridge.js";
import { createPlan, createUnaryPlan, type Plan } from "./model.js";

function isRuntimeBypass(error: unknown): error is UnhandledException | TimeoutError {
  return UnhandledException.is(error) || TimeoutError.is(error);
}

function trackedDomainError<E>(error: unknown): TrackedErr<E> | undefined {
  if (isRuntimeBypass(error)) return undefined;
  // SAFETY: TS cannot narrow E to TrackedErr<E> after the bypass guard; bypass faults return above.
  return unsafeCoerce(error);
}

export function mapPlan<T, E, U, M>(
  source: Plan<T, E, M>,
  transform: (value: T) => U,
): Plan<Awaited<U>, E, M> {
  return createUnaryPlan(
    function* () {
      const result: Result<T, E | UnhandledException> =
        yield* Settlement.cooperative.suspendPlan(source);

      if (result.isErr()) return yield* result;

      const mapped: Awaited<U> = yield* new SuspendInstruction(() =>
        Promise.resolve(transform(result.value)),
      );

      return mapped;
    },
    source,
    (inner) => mapPlan(inner, transform),
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
    const first: Result<T, E | UnhandledException> =
      yield* Settlement.cooperative.suspendPlan(source);

    if (first.isErr()) return yield* first;

    const second: Result<
      InferOpOk<R>,
      InferOpErr<R> | UnhandledException
    > = yield* Settlement.cooperative.suspendPlan(getPlan(bind(first.value), []));

    if (second.isErr()) return yield* second;
    return second.value;
  });
}

export function tapPlan<T, E, R, M>(
  source: Plan<T, E, M>,
  observe: (value: T) => R,
): Plan<T, E, M> {
  return createUnaryPlan(
    function* () {
      const sourceResult: Result<T, E | UnhandledException> =
        yield* Settlement.cooperative.suspendPlan(source);

      if (sourceResult.isErr()) return yield* sourceResult;

      yield* new SuspendInstruction(() => Promise.resolve(observe(sourceResult.value)));
      return sourceResult.value;
    },
    source,
    (inner) => tapPlan(inner, observe),
  );
}

export function mapErrPlan<T, E, E2, M>(
  source: Plan<T, E, M>,
  transform: (error: TrackedErr<E>) => E2,
): Plan<T, E2 | BypassedErr<E>, M> {
  return createUnaryPlan(
    function* () {
      const result: Result<T, E | UnhandledException> =
        yield* Settlement.cooperative.suspendPlan(source);

      if (result.isOk()) return result.value;

      const domainError = trackedDomainError<E>(result.error);
      if (domainError === undefined) return yield* result;

      const mapped: E2 = yield* new SuspendInstruction(() =>
        Promise.resolve(transform(domainError)),
      );

      return yield* Result.err(mapped);
    },
    source,
    (inner) => mapErrPlan(inner, transform),
  );
}

export function tapErrPlan<T, E, R, M>(
  source: Plan<T, E, M>,
  observe: (error: TrackedErr<E>) => R,
): Plan<T, TrackedErr<E> | BypassedErr<E>, M> {
  return createUnaryPlan(
    function* () {
      const sourceResult: Result<T, E | UnhandledException> =
        yield* Settlement.cooperative.suspendPlan(source);

      if (sourceResult.isOk()) return sourceResult.value;

      const domainError = trackedDomainError<E>(sourceResult.error);
      if (domainError === undefined) return yield* sourceResult;

      yield* new SuspendInstruction(() => Promise.resolve(observe(domainError)));
      return yield* sourceResult;
    },
    source,
    (inner) => tapErrPlan(inner, observe),
  );
}

export function recoverPlan<T, E, ECaught extends TrackedErr<E>, R, M>(
  source: Plan<T, E, M>,
  predicate: (error: TrackedErr<E>) => error is ECaught,
  handler: (error: ECaught) => R,
): Plan<T | Awaited<R>, TrackedErr<E, ECaught> | BypassedErr<E>, M> {
  return createUnaryPlan(
    function* () {
      const result: Result<T, E | UnhandledException> =
        yield* Settlement.cooperative.suspendPlan(source);

      if (result.isOk()) return result.value;

      const error = trackedDomainError<E>(result.error);
      if (error === undefined) return yield* result;

      if (!predicate(error)) return yield* result;

      const recovered: Awaited<R> = yield* new SuspendInstruction(() =>
        Promise.resolve(handler(error)),
      );

      return recovered;
    },
    source,
    (inner) => recoverPlan(inner, predicate, handler),
  );
}
