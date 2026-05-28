import { getIterablePlan, getPlan } from "./plan/base.js";
import { onEnterPlan, onExitPlan, withReleasePlan } from "./plan/lifecycle.js";
import { makePlanOp } from "./plan/shell.js";
import {
  asOpInterface,
  createDefaultHooks,
  flatMapCoreOp,
  makeCoreOp,
  mapCoreOp,
  mapErrCoreOp,
  onEnterCoreOp,
  onExitCoreOp,
  recoverCoreOp,
  tapCoreOp,
  tapErrCoreOp,
  withCleanupCoreOp,
} from "./fluent-nullary.js";
import type {
  EmptyMeta,
  EnterFn,
  ExitFn,
  LifecycleFn,
  OpInterface,
  OpLifecycleHook,
  ReleaseFn,
} from "./types.js";
import type { Op } from "../index.js";
import { coerceToNullaryOp, unsafeCoerce } from "../shared.js";

export {
  asOpInterface,
  createDefaultHooks,
  flatMapCoreOp,
  makeCoreOp,
  mapCoreOp,
  mapErrCoreOp,
  onEnterCoreOp,
  onExitCoreOp,
  recoverCoreOp,
  tapCoreOp,
  tapErrCoreOp,
  withCleanupCoreOp,
} from "./fluent-nullary.js";
export { makePlanOp } from "./plan/shell.js";

function asPublicOp<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: OpInterface<T, E, A, M, Yieldable>,
): Op<T, E, A, M> {
  // SAFETY: OpInterface values built by makePlanOp carry the internal Op brand at runtime.
  return unsafeCoerce(op);
}

function iterablePlanFor<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: OpInterface<T, E, A, M, Yieldable>,
) {
  // SAFETY: getIterablePlan checks the runtime iterable brand before reading the iterator.
  const iterableCandidate = unsafeCoerce<Op<T, E, [], M>>(op);
  return getIterablePlan(iterableCandidate);
}

export function onExitOp<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: OpInterface<T, E, A, M, Yieldable>,
  finalize: ExitFn<T, E, A>,
): OpInterface<T, E, A, M, Yieldable> {
  const source = asPublicOp(op);
  const iterable = iterablePlanFor(op);
  return makePlanOp<T, E, A, M, Yieldable>(
    (...args) => onExitPlan(getPlan(source, args), finalize),
    iterable === undefined
      ? undefined
      : () => onExitPlan(iterable, finalize as unknown as ExitFn<T, E, []>),
    coerceToNullaryOp(source) !== undefined,
  );
}

export function onEnterOp<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: OpInterface<T, E, A, M, Yieldable>,
  initialize: EnterFn<A>,
): OpInterface<T, E, A, M, Yieldable> {
  const source = asPublicOp(op);
  const iterable = iterablePlanFor(op);
  return makePlanOp<T, E, A, M, Yieldable>(
    (...args) => onEnterPlan(getPlan(source, args), initialize),
    iterable === undefined
      ? undefined
      : () => onEnterPlan(iterable, initialize as unknown as EnterFn<[]>),
    coerceToNullaryOp(source) !== undefined,
  );
}

export function onOp<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: OpInterface<T, E, A, M, Yieldable>,
  event: OpLifecycleHook,
  handler: LifecycleFn<T, E, A>,
): OpInterface<T, E, A, M, Yieldable> {
  if (event === "enter") {
    return onEnterOp(op, handler as EnterFn<A>);
  }

  if (event === "exit") {
    return onExitOp(op, handler as ExitFn<T, E, A>);
  }

  throw new Error(`Invalid event: ${event}`);
}

export function withReleaseOp<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: OpInterface<T, E, A, M, Yieldable>,
  release: ReleaseFn<T>,
): OpInterface<T, E, A, M, Yieldable> {
  const source = asPublicOp(op);
  const iterable = iterablePlanFor(op);
  return makePlanOp<T, E, A, M, Yieldable>(
    (...args) => withReleasePlan(getPlan(source, args), release),
    iterable === undefined ? undefined : () => withReleasePlan(iterable, release),
    coerceToNullaryOp(source) !== undefined,
  );
}

export type { EmptyMeta };
