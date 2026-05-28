import { TimeoutError } from "../errors.js";
import type { Op } from "../index.js";
import { unsafeCoerce } from "../shared.js";
import type {
  AnyNullaryOp,
  ExitFn,
  InferOpErr,
  InferOpMeta,
  InferOpOk,
  MergeMeta,
} from "./types.js";
import { mapErrCoreOp, onExitCoreOp, recoverCoreOp, tapErrCoreOp } from "./fluent-nullary.js";

function adaptErrorCallbackForTimeout<E, TOut>(
  fn: (error: E) => TOut,
  onTimeout: (error: TimeoutError) => TOut,
): (error: E | TimeoutError) => TOut {
  return (error) => (TimeoutError.is(error) ? onTimeout(error) : fn(error));
}

function adaptRecoverPredicateForTimeout<E, ECaught extends E>(
  predicate: (error: E) => error is ECaught,
): (error: E | TimeoutError) => error is ECaught {
  return (error): error is ECaught => !TimeoutError.is(error) && predicate(error);
}

function coerceTimeoutInner<T, E, M>(newInner: unknown): Op<T, E | TimeoutError, [], M> {
  // SAFETY: timeout push-through widens only the error channel with TimeoutError
  return unsafeCoerce(newInner);
}

export function mapErrCoreRebuildForTimeout<T, E, E2, M>(transform: (error: E) => E2) {
  // oxlint-disable-next-line typescript/no-explicit-any
  return (newInner: AnyNullaryOp) =>
    mapErrCoreOp(
      coerceTimeoutInner<T, E, M>(newInner),
      adaptErrorCallbackForTimeout<E, E2 | TimeoutError>(transform, (error) => error),
    );
}

export function tapErrCoreRebuildForTimeout<T, E, R, M>(observe: (error: E) => R) {
  return (newInner: unknown): Op<T, E | TimeoutError, [], MergeMeta<M, InferOpMeta<R>>> =>
    // SAFETY: timeout filtering preserves the observer metadata while widening only error type.
    unsafeCoerce<Op<T, E | TimeoutError, [], MergeMeta<M, InferOpMeta<R>>>>(
      tapErrCoreOp(
        coerceTimeoutInner<T, E, M>(newInner),
        adaptErrorCallbackForTimeout(observe, () => undefined),
      ),
    );
}

export function recoverCoreRebuildForTimeout<T, E, ECaught extends E, R, M>(
  predicate: (error: E) => error is ECaught,
  handler: (error: ECaught) => R,
) {
  return (
    newInner: unknown,
  ): Op<T | InferOpOk<R>, E | InferOpErr<R> | TimeoutError, [], MergeMeta<M, InferOpMeta<R>>> =>
    recoverCoreOp(
      coerceTimeoutInner<T, E, M>(newInner),
      adaptRecoverPredicateForTimeout(predicate),
      handler,
    );
}

export function onExitCoreRebuildForTimeout<T, E, M>(finalize: ExitFn<T, E, []>) {
  return (newInner: unknown) =>
    onExitCoreOp(
      coerceTimeoutInner<T, E, M>(newInner),
      // SAFETY: TimeoutError is filtered before `finalize`, so it still only receives `E`.
      unsafeCoerce(finalize),
    );
}

export function mapErrLiftForTimeout<T, E, E2, M>(
  transform: (error: E) => E2,
  resolved: Op<T, E | TimeoutError, [], M>,
): Op<T, E2 | TimeoutError, [], M> {
  return mapErrCoreOp(
    resolved,
    adaptErrorCallbackForTimeout<E, E2 | TimeoutError>(transform, (error) => error),
  );
}

export function tapErrLiftCallbacks<T, E, R, M>(observe: (error: E) => R) {
  return {
    mapCore: (resolved: Op<T, E, [], M>) =>
      // SAFETY: tapErr metadata matches the timeout-filtered observer path.
      unsafeCoerce<Op<T, E | InferOpErr<R>, [], MergeMeta<M, InferOpMeta<R>>>>(
        tapErrCoreOp(resolved, observe),
      ),
    mapCoreForTimeout: (resolved: Op<T, E | TimeoutError, [], M>) =>
      // SAFETY: tapErr metadata matches the timeout-filtered observer path.
      unsafeCoerce<Op<T, E | InferOpErr<R> | TimeoutError, [], MergeMeta<M, InferOpMeta<R>>>>(
        tapErrCoreOp(
          resolved,
          adaptErrorCallbackForTimeout(observe, () => undefined),
        ),
      ),
  };
}

export function recoverLiftForTimeout<T, E, ECaught extends E, R, M>(
  predicate: (error: E) => error is ECaught,
  handler: (error: ECaught) => R,
  resolved: Op<T, E | TimeoutError, [], M>,
): Op<T | InferOpOk<R>, E | InferOpErr<R> | TimeoutError, [], MergeMeta<M, InferOpMeta<R>>> {
  return recoverCoreOp(resolved, adaptRecoverPredicateForTimeout(predicate), handler);
}
