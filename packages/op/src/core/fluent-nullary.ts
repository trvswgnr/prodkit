import {
  flatMapPlan,
  mapErrPlan,
  mapPlan,
  recoverPlan,
  tapErrPlan,
  tapPlan,
} from "./plan/transforms.js";
import { genPlan, getPlan } from "./plan/base.js";
import { onEnterPlan, onExitPlan, withReleasePlan } from "./plan/lifecycle.js";
import { makePlanOp } from "./plan/shell.js";
import type {
  AnyNullaryOp,
  BypassedErr,
  DefaultHooks,
  EmptyMeta,
  EnterFn,
  ExitFn,
  InferOpErr,
  InferOpMeta,
  InferOpOk,
  Instruction,
  MergeMeta,
  OpInterface,
  ReleaseFn,
  TrackedErr,
} from "./types.js";
import type { Op } from "../index.js";
import { EMPTY_TUPLE, unsafeCoerce } from "../shared.js";

function asOp<T, E, M>(op: OpInterface<T, E, [], M>): Op<T, E, [], M> {
  // SAFETY: makePlanOp installs the internal Op brand and callable method surface.
  return unsafeCoerce(op);
}

export function createDefaultHooks<T, E, M>(getSelf: () => Op<T, E, [], M>): DefaultHooks<T, E, M> {
  return {
    withRelease: (release) => withCleanupCoreOp(getSelf(), release),
    registerEnterInitialize: (initialize) => onEnterCoreOp(getSelf(), initialize),
    registerExitFinalize: (finalize) => onExitCoreOp(getSelf(), finalize),
  };
}

export function makeCoreOp<T, E, M = EmptyMeta>(
  gen: () => Generator<Instruction<E, M>, T, unknown>,
  _hooks?: DefaultHooks<T, unknown, M>,
): Op<T, TrackedErr<E>, [], M> {
  return asOp(
    makePlanOp(
      () => genPlan(gen),
      () => genPlan(gen),
      true,
    ),
  );
}

export function withCleanupCoreOp<T, E, M>(
  op: Op<T, E, [], M>,
  release: ReleaseFn<T>,
): Op<T, E, [], M> {
  return asOp(
    makePlanOp(
      () => withReleasePlan(getPlan(op, EMPTY_TUPLE), release),
      () => withReleasePlan(getPlan(op, EMPTY_TUPLE), release),
      true,
    ),
  );
}

export function onEnterCoreOp<T, E, M>(
  op: Op<T, E, [], M>,
  initialize: EnterFn<[]>,
): Op<T, E, [], M> {
  return asOp(
    makePlanOp(
      () => onEnterPlan(getPlan(op, EMPTY_TUPLE), initialize),
      () => onEnterPlan(getPlan(op, EMPTY_TUPLE), initialize),
      true,
    ),
  );
}

export function onExitCoreOp<T, E, M>(
  op: Op<T, E, [], M>,
  finalize: ExitFn<T, E, []>,
): Op<T, E, [], M> {
  return asOp(
    makePlanOp(
      () => onExitPlan(getPlan(op, EMPTY_TUPLE), finalize),
      () => onExitPlan(getPlan(op, EMPTY_TUPLE), finalize),
      true,
    ),
  );
}

export function mapCoreOp<T, E, U>(
  op: Op<T, E, [], EmptyMeta>,
  transform: (value: T) => U,
): Op<Awaited<U>, E, [], EmptyMeta>;
export function mapCoreOp<T, E, U, M>(
  op: Op<T, E, [], M>,
  transform: (value: T) => U,
): Op<Awaited<U>, E, [], M>;
export function mapCoreOp<T, E, U, M>(
  op: Op<T, E, [], M>,
  transform: (value: T) => U,
): Op<Awaited<U>, E, [], M> {
  return asOp(
    makePlanOp(
      () => mapPlan(getPlan(op, EMPTY_TUPLE), transform),
      () => mapPlan(getPlan(op, EMPTY_TUPLE), transform),
      true,
    ),
  );
}

export function flatMapCoreOp<T, E, R extends AnyNullaryOp, M>(
  op: Op<T, E, [], M>,
  bind: (value: T) => R,
): Op<InferOpOk<R>, E | InferOpErr<R>, [], MergeMeta<M, InferOpMeta<R>>> {
  return asOp(
    makePlanOp(
      () => flatMapPlan(getPlan(op, EMPTY_TUPLE), bind),
      () => flatMapPlan(getPlan(op, EMPTY_TUPLE), bind),
      true,
    ),
  );
}

export function tapCoreOp<T, E, R, M>(
  op: Op<T, E, [], M>,
  observe: (value: T) => R,
): Op<T, E | InferOpErr<R>, [], MergeMeta<M, InferOpMeta<R>>> {
  return asOp(
    makePlanOp(
      () => tapPlan(getPlan(op, EMPTY_TUPLE), observe),
      () => tapPlan(getPlan(op, EMPTY_TUPLE), observe),
      true,
    ),
  );
}

export function tapErrCoreOp<T, E, R, M>(
  op: Op<T, E, [], M>,
  observe: (error: TrackedErr<E>) => R,
): Op<T, TrackedErr<E> | BypassedErr<E> | InferOpErr<R>, [], MergeMeta<M, InferOpMeta<R>>> {
  return asOp(
    makePlanOp(
      () => tapErrPlan(getPlan(op, EMPTY_TUPLE), observe),
      () => tapErrPlan(getPlan(op, EMPTY_TUPLE), observe),
      true,
    ),
  );
}

export function mapErrCoreOp<T, E, E2, M>(
  op: Op<T, E, [], M>,
  transform: (error: TrackedErr<E>) => E2,
): Op<T, E2 | BypassedErr<E>, [], M> {
  return asOp(
    makePlanOp(
      () => mapErrPlan(getPlan(op, EMPTY_TUPLE), transform),
      () => mapErrPlan(getPlan(op, EMPTY_TUPLE), transform),
      true,
    ),
  );
}

export function recoverCoreOp<T, E, ECaught extends TrackedErr<E>, R, M>(
  op: Op<T, E, [], M>,
  predicate: (error: TrackedErr<E>) => error is ECaught,
  handler: (error: ECaught) => R,
): Op<
  T | InferOpOk<R>,
  TrackedErr<E, ECaught> | BypassedErr<E> | InferOpErr<R>,
  [],
  MergeMeta<M, InferOpMeta<R>>
> {
  return asOp(
    makePlanOp(
      () => recoverPlan(getPlan(op, EMPTY_TUPLE), predicate, handler),
      () => recoverPlan(getPlan(op, EMPTY_TUPLE), predicate, handler),
      true,
    ),
  );
}

/**
 * Casts an Op to a tuple-arity op surface.
 *
 * TypeScript cannot preserve the full callable+fluent intersection through some
 * generic transforms (for example `Object.assign` + tuple-parameterized call signatures).
 * This cast re-attaches the known arity shape after those transforms.
 *
 * @warning This function is UNSAFE and should be used only when the type is known to be correct.
 */
export function asOpInterface<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: Op<T, E, A, M>,
): OpInterface<T, E, A, M, Yieldable> {
  // SAFETY: Op<T, E, A> is the public branded intersection over OpInterface<T, E, A>.
  return unsafeCoerce(op);
}
