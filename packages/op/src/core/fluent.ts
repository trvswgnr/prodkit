import { TimeoutError } from "../errors.js";
import {
  mapErrLiftForTimeout,
  recoverLiftForTimeout,
  tapErrLiftCallbacks,
} from "./fluent-timeout.js";
import {
  asOpInterface,
  flatMapCoreOp,
  mapCoreOp,
  mapErrCoreOp,
  onEnterCoreOp,
  onExitCoreOp,
  recoverCoreOp,
  tapCoreOp,
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
  AnyNullaryOp,
} from "./types.js";
import type { Op } from "../index.js";
import { type RetryPolicy } from "../policies.js";
import { createRunContext, drive } from "./runtime.js";
import {
  unsafeCoerce,
  coerceToNullaryOp,
  isIterableOp,
  OP_BOUND_BRAND,
  OP_BRAND,
} from "../shared.js";

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

export interface FluentHandlers<T, E, A extends readonly unknown[], M, Yieldable extends boolean> {
  withRetry: (policy?: RetryPolicy) => OpInterface<T, E, A, M, Yieldable>;
  withTimeout: (timeoutMs: number) => OpInterface<T, E | TimeoutError, A, M, Yieldable>;
  withSignal: (signal: AbortSignal) => OpInterface<T, E, A, M, Yieldable>;
  withRelease: (release: ReleaseFn<T>) => OpInterface<T, E, A, M, Yieldable>;
  on: (event: OpLifecycleHook, handler: LifecycleFn<T, E, A>) => OpInterface<T, E, A, M, Yieldable>;
}

export function makeFluentOp<
  T,
  E,
  A extends readonly unknown[],
  M = EmptyMeta,
  Yieldable extends boolean = A extends [] ? true : false,
>(
  invoke: (...args: A) => Op<T, E, [], M>,
  makeHandlers: (self: OpInterface<T, E, A, M, Yieldable>) => FluentHandlers<T, E, A, M, Yieldable>,
  makeIterable?: () => Op<T, E, [], M>,
  bound = false,
): OpInterface<T, E, A, M, Yieldable> {
  // SAFETY: `invoke` already has runtime signature `(...args: A) => Op<T, E, []>`.
  // `Object.assign` only decorates that function object with fluent handlers, so this
  // cast restores the intended callable+methods intersection that TS cannot infer.
  const self: OpInterface<T, E, A, M, Yieldable> = unsafeCoerce(
    Object.assign(invoke, {
      run: (...args: A) =>
        drive(invoke(...args), createRunContext(new AbortController().signal, args)),
      withRetry: (policy?: RetryPolicy) => makeHandlers(self).withRetry(policy),
      withTimeout: (timeoutMs: number) => makeHandlers(self).withTimeout(timeoutMs),
      withSignal: (signal: AbortSignal) => makeHandlers(self).withSignal(signal),
      withRelease: (release: ReleaseFn<T>) => makeHandlers(self).withRelease(release),
      on: (event: OpLifecycleHook, handler: LifecycleFn<T, E, A>) =>
        makeHandlers(self).on(event, handler),
      map: <U>(transform: (value: T) => U) =>
        liftOp(
          self,
          (resolved) => mapCoreOp(resolved, transform),
          (resolved) => mapCoreOp(resolved, transform),
        ),
      mapErr: <E2>(transform: (error: E) => E2) =>
        liftOp(
          self,
          (resolved) => mapErrCoreOp(resolved, transform),
          (resolved) => mapErrLiftForTimeout<T, E, E2, M>(transform, resolved),
        ),
      flatMap: <R extends AnyNullaryOp>(bind: (value: T) => R) =>
        liftOp(
          self,
          (resolved) => flatMapCoreOp(resolved, bind),
          (resolved) => flatMapCoreOp(resolved, bind),
        ),
      tap: <R>(observe: (value: T) => R) =>
        liftOp(
          self,
          (resolved) => tapCoreOp(resolved, observe),
          (resolved) => tapCoreOp(resolved, observe),
        ),
      tapErr: <R>(observe: (error: E) => R) => {
        const { mapCore, mapCoreForTimeout } = tapErrLiftCallbacks<T, E, R, M>(observe);
        return liftOp(self, mapCore, mapCoreForTimeout);
      },
      recover: <R>(predicate: (error: E) => boolean, handler: (error: E) => R) =>
        liftOp(
          self,
          (resolved) => recoverCoreOp(resolved, predicate, handler),
          (resolved) => recoverLiftForTimeout<T, E, R, M>(predicate, handler, resolved),
        ),
      [OP_BRAND]: true,
      [OP_BOUND_BRAND]: bound,
      _tag: "Op" as const,
    }),
  );
  if (makeIterable !== undefined) {
    Object.assign(self, {
      // Bridge `yield* op` runtime interop for ops produced from generic wrappers.
      [Symbol.iterator]: () => makeIterable()[Symbol.iterator](),
    });
  }
  return self;
}

export function liftOp<
  TIn,
  EIn,
  A extends readonly unknown[],
  MIn,
  TOut,
  EOut,
  MOut,
  Yieldable extends boolean,
>(
  op: OpInterface<TIn, EIn, A, MIn, Yieldable>,
  mapCore: (resolved: Op<TIn, EIn, [], MIn>) => Op<TOut, EOut, [], MOut>,
  mapCoreForTimeout: (
    resolved: Op<TIn, EIn | TimeoutError, [], MIn>,
  ) => Op<TOut, EOut | TimeoutError, [], MOut>,
): OpInterface<TOut, EOut, A, MOut, Yieldable> {
  return makeFluentOp<TOut, EOut, A, MOut, Yieldable>(
    (...args) => mapCore(op(...args)),
    (self) => ({
      withRetry: (policy) =>
        liftOp(asOpInterface(op.withRetry(policy)), mapCore, mapCoreForTimeout),
      withTimeout: (timeoutMs) =>
        liftOp<TIn, EIn | TimeoutError, A, MIn, TOut, EOut | TimeoutError, MOut, Yieldable>(
          asOpInterface(op.withTimeout(timeoutMs)),
          mapCoreForTimeout,
          mapCoreForTimeout,
        ),
      withSignal: (signal) =>
        liftOp(asOpInterface(op.withSignal(signal)), mapCore, mapCoreForTimeout),
      withRelease: (release) => withReleaseOp(self, release),
      on: (event, handler) => onOp(self, event, handler),
    }),
    isIterableOp(op)
      ? () =>
          mapCore(
            // SAFETY: `isIterableOp` proves `op` has the nullary iterator surface.
            unsafeCoerce<Op<TIn, EIn, [], MIn>>(op)(),
          )
      : undefined,
    coerceToNullaryOp(op) !== undefined,
  );
}

export function onExitOp<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: OpInterface<T, E, A, M, Yieldable>,
  finalize: ExitFn<T, E, A>,
): OpInterface<T, E, A, M, Yieldable> {
  const source = op;
  return makeFluentOp<T, E, A, M, Yieldable>(
    (...args) =>
      onExitCoreOp(source(...args), (ctx) =>
        finalize({
          signal: ctx.signal,
          result: ctx.result,
          args,
        }),
      ),
    (self) => ({
      withRetry: (policy) => onExitOp(asOpInterface(source.withRetry(policy)), finalize),
      withTimeout: (timeoutMs) =>
        onExitOp(
          asOpInterface(source.withTimeout(timeoutMs)),
          // SAFETY: `withTimeout` widens error to `E | TimeoutError`, so widen finalize accordingly.
          unsafeCoerce(finalize),
        ),
      withSignal: (signal) => onExitOp(asOpInterface(source.withSignal(signal)), finalize),
      withRelease: (release) => withReleaseOp(self, release),
      on: (event, handler) => onOp(self, event, handler),
    }),
    isIterableOp(source)
      ? () =>
          onExitCoreOp(
            // SAFETY: `isIterableOp` proves `source` has the nullary iterator surface.
            unsafeCoerce<Op<T, E, [], M>>(source)(),
            // SAFETY: nullary iterator composition has no runtime args, so the finalize arity is compatible.
            unsafeCoerce(finalize),
          )
      : undefined,
    coerceToNullaryOp(source) !== undefined,
  );
}

export function onEnterOp<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: OpInterface<T, E, A, M, Yieldable>,
  initialize: EnterFn<A>,
): OpInterface<T, E, A, M, Yieldable> {
  const source = op;
  return makeFluentOp<T, E, A, M, Yieldable>(
    (...args) => onEnterCoreOp(source(...args), ({ signal }) => initialize({ signal, args })),
    (self) => ({
      withRetry: (policy) => onEnterOp(asOpInterface(source.withRetry(policy)), initialize),
      withTimeout: (timeoutMs) =>
        onEnterOp(asOpInterface(source.withTimeout(timeoutMs)), initialize),
      withSignal: (signal) => onEnterOp(asOpInterface(source.withSignal(signal)), initialize),
      withRelease: (release) => withReleaseOp(self, release),
      on: (event, handler) => onOp(self, event, handler),
    }),
    isIterableOp(source)
      ? () =>
          onEnterCoreOp(
            // SAFETY: `isIterableOp` proves `source` has the nullary iterator surface.
            unsafeCoerce<Op<T, E, [], M>>(source)(),
            // SAFETY: nullary iterator composition has no runtime args, so the initialize arity is compatible.
            unsafeCoerce(initialize),
          )
      : undefined,
    coerceToNullaryOp(source) !== undefined,
  );
}

export function onOp<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: OpInterface<T, E, A, M, Yieldable>,
  event: OpLifecycleHook,
  handler: LifecycleFn<T, E, A>,
): OpInterface<T, E, A, M, Yieldable> {
  const dispatch = event === "enter" ? onEnterOp : event === "exit" ? onExitOp : undefined;

  if (dispatch === undefined) {
    throw new Error(`Invalid event: ${event}`);
  }

  return dispatch(
    op,
    // SAFETY: runtime event discriminant selects the enter/exit handler overload.
    unsafeCoerce(handler),
  );
}

export function withReleaseOp<T, E, A extends readonly unknown[], M, Yieldable extends boolean>(
  op: OpInterface<T, E, A, M, Yieldable>,
  release: ReleaseFn<T>,
): OpInterface<T, E, A, M, Yieldable> {
  const source = op;
  return makeFluentOp<T, E, A, M, Yieldable>(
    (...args) => withCleanupCoreOp(source(...args), release),
    (self) => ({
      withRetry: (policy) => withReleaseOp(asOpInterface(source.withRetry(policy)), release),
      withTimeout: (timeoutMs) =>
        withReleaseOp(asOpInterface(source.withTimeout(timeoutMs)), release),
      withSignal: (signal) => withReleaseOp(asOpInterface(source.withSignal(signal)), release),
      withRelease: (nextRelease) => withReleaseOp(self, nextRelease),
      on: (event, handler) => onOp(self, event, handler),
    }),
    isIterableOp(source)
      ? () =>
          withCleanupCoreOp(
            // SAFETY: `isIterableOp` proves `source` has the nullary iterator surface.
            unsafeCoerce<Op<T, E, [], M>>(source)(),
            release,
          )
      : undefined,
    coerceToNullaryOp(source) !== undefined,
  );
}
