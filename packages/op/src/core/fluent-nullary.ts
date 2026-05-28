import { UnhandledException } from "../errors.js";
import {
  mapErrCoreRebuildForTimeout,
  onExitCoreRebuildForTimeout,
  recoverCoreRebuildForTimeout,
  tapErrCoreRebuildForTimeout,
} from "./fluent-timeout.js";
import { Result } from "../result.js";
import { withRetryOp, withSignalOp, withTimeoutOp, type RetryPolicy } from "../policies.js";
import type {
  EnterContext,
  EnterFn,
  ExitContext,
  ExitFn,
  EmptyMeta,
  OpInterface,
  Instruction,
  LifecycleFn,
  MergeMeta,
  OpHooks,
  OpLifecycleHook,
  InferOpErr,
  InferOpMeta,
  InferOpOk,
  ReleaseFn,
  TrackedErr,
  AnyNullaryOp,
  DefaultHooks,
} from "./types.js";
import type { Op } from "../index.js";
import { RegisterExitFinalizerInstruction, SuspendInstruction } from "./instructions.js";
import { drive } from "./runtime.js";
import { runOp } from "./run-op.js";
import {
  unsafeCoerce,
  coerceToNullaryOp,
  EMPTY_TUPLE,
  OP_BOUND_BRAND,
  OP_BRAND,
} from "../shared.js";

function dispatchLifecycleCore<T, E, M>(
  hooks: OpHooks<T, E, M>,
  event: OpLifecycleHook,
  handler: LifecycleFn<T, E, []>,
): Op<T, E, [], M> {
  const hook = hooks[event === "enter" ? "registerEnterInitialize" : "registerExitFinalize"];

  if (hook === undefined) {
    throw new Error(`Invalid event: ${event}`);
  }

  return hook(
    // SAFETY: runtime event discriminant selects the exit handler overload.
    unsafeCoerce(handler),
  );
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
  hooks: OpHooks<T, E, M>,
): Op<T, TrackedErr<E>, [], M> {
  let self: Op<T, TrackedErr<E>, [], M>;
  const hasPushThroughConfig = hooks.inner !== undefined && hooks.rebuild !== undefined;
  const pushInner = hooks.inner;
  const rebuild = hooks.rebuild;
  const rebuildForTimeout = hooks.rebuildForTimeout ?? hooks.rebuild;
  const state = {
    [Symbol.iterator]: gen,
    run: () => runOp(self),
    withRetry: (policy?: RetryPolicy) => {
      if (!hasPushThroughConfig || pushInner === undefined || rebuild === undefined) {
        return withRetryOp(self, policy);
      }
      return rebuild(pushInner.withRetry(policy));
    },
    withTimeout: (timeoutMs: number) => {
      if (!hasPushThroughConfig || pushInner === undefined || rebuildForTimeout === undefined) {
        return withTimeoutOp(self, timeoutMs);
      }
      return rebuildForTimeout(pushInner.withTimeout(timeoutMs));
    },
    withSignal: (signal: AbortSignal) => {
      if (!hasPushThroughConfig || pushInner === undefined || rebuild === undefined) {
        return withSignalOp(self, signal);
      }
      return rebuild(pushInner.withSignal(signal));
    },
    withRelease: hooks.withRelease,
    on: (event: OpLifecycleHook, handler: LifecycleFn<T, E, []>) =>
      dispatchLifecycleCore(hooks, event, handler),
    map: <U>(transform: (value: T) => U) => mapCoreOp(self, transform),
    mapErr: <E2>(transform: (error: E) => E2) => mapErrCoreOp(self, transform),
    flatMap: <R extends AnyNullaryOp>(bind: (value: T) => R) => flatMapCoreOp(self, bind),
    tap: <R>(observe: (value: T) => R) => tapCoreOp(self, observe),
    tapErr: <R>(observe: (error: E) => R) => tapErrCoreOp(self, observe),
    recover: <ECaught extends E, R>(
      predicate: (error: E) => error is ECaught,
      handler: (error: ECaught) => R,
    ) => recoverCoreOp(self, predicate, handler),
    [OP_BRAND]: true,
    [OP_BOUND_BRAND]: true,
    _tag: "Op" as const,
  };

  const callable = () => self;

  // SAFETY: `Object.assign` only decorates that function object with fluent handlers, so this
  // cast restores the intended callable+methods intersection that TS cannot infer
  self = unsafeCoerce(Object.assign(callable, state));

  return self;
}

export function withCleanupCoreOp<T, E, M>(
  op: Op<T, E, [], M>,
  release: ReleaseFn<T>,
): Op<T, E, [], M> {
  return makeCoreOp<T, E | UnhandledException, M>(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        drive(op, context),
      );

      if (result.isErr()) return yield* result;

      yield new RegisterExitFinalizerInstruction(() =>
        Promise.resolve(release(result.value)).then(() => {}),
      );

      return result.value;
    },
    {
      inner: op,
      rebuild: (newInner) =>
        withCleanupCoreOp(
          // SAFETY: rebuild callbacks are only used with the `inner` op they declared in this hook.
          unsafeCoerce<Op<T, E, [], M>>(newInner),
          release,
        ),
      withRelease: (nextRelease) => withCleanupCoreOp(withCleanupCoreOp(op, release), nextRelease),
      registerEnterInitialize: (initialize) =>
        onEnterCoreOp(withCleanupCoreOp(op, release), initialize),
      registerExitFinalize: (finalize) => onExitCoreOp(withCleanupCoreOp(op, release), finalize),
    },
  );
}

export function onEnterCoreOp<T, E, M>(
  op: Op<T, E, [], M>,
  initialize: EnterFn<[]>,
): Op<T, E, [], M> {
  return makeCoreOp<T, E | UnhandledException, M>(
    function* () {
      yield new SuspendInstruction(async (context) => {
        const enterCtx: EnterContext<[]> = { signal: context.signal, args: EMPTY_TUPLE };
        await Promise.resolve(initialize(enterCtx));
      });

      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        drive(op, context),
      );

      if (result.isErr()) return yield* Result.err(result.error);
      return result.value;
    },
    {
      inner: op,

      rebuild: (newInner) =>
        onEnterCoreOp(
          // SAFETY: rebuild callbacks are only used with the `inner` op they declared in this hook.
          unsafeCoerce<Op<T, E, [], M>>(newInner),
          initialize,
        ),
      withRelease: (release) => withCleanupCoreOp(onEnterCoreOp(op, initialize), release),
      registerEnterInitialize: (nextInitialize) =>
        onEnterCoreOp(onEnterCoreOp(op, initialize), nextInitialize),
      registerExitFinalize: (finalize) => onExitCoreOp(onEnterCoreOp(op, initialize), finalize),
    },
  );
}

export function onExitCoreOp<T, E, M>(
  op: Op<T, E, [], M>,
  finalize: ExitFn<T, E, []>,
): Op<T, E, [], M> {
  return makeCoreOp<T, E | UnhandledException, M>(
    function* () {
      yield new RegisterExitFinalizerInstruction(async (ctx) => {
        const exitCtx: ExitContext<T, E, []> = {
          signal: ctx.signal,
          // SAFETY: this finalizer is registered by the op that produced the result type `T | E`.
          result: unsafeCoerce(ctx.result),
          args: EMPTY_TUPLE,
        };
        await Promise.resolve(finalize(exitCtx));
      });

      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        drive(op, context),
      );

      if (result.isErr()) return yield* Result.err(result.error);
      return result.value;
    },
    {
      inner: op,

      rebuild: (newInner) =>
        onExitCoreOp(
          // SAFETY: rebuild callbacks are only used with the `inner` op they declared in this hook
          unsafeCoerce<Op<T, E, [], M>>(newInner),
          finalize,
        ),
      rebuildForTimeout: onExitCoreRebuildForTimeout(finalize),
      withRelease: (release) => withCleanupCoreOp(onExitCoreOp(op, finalize), release),
      registerEnterInitialize: (initialize) =>
        onEnterCoreOp(onExitCoreOp(op, finalize), initialize),
      registerExitFinalize: (nextFinalize) =>
        onExitCoreOp(onExitCoreOp(op, finalize), nextFinalize),
    },
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
  return makeCoreOp<Awaited<U>, E | UnhandledException, M>(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        drive(op, context),
      );

      if (result.isErr()) return yield* result;

      const mapped: Awaited<U> = yield* new SuspendInstruction(() =>
        Promise.resolve(transform(result.value)),
      );

      return mapped;
    },
    {
      ...createDefaultHooks(() => mapCoreOp(op, transform)),
      inner: op,

      rebuild: (newInner) =>
        mapCoreOp(
          // SAFETY: rebuild callbacks are only used with the `inner` op they declared in this hook.
          unsafeCoerce<Op<T, E, [], M>>(newInner),
          transform,
        ),
    },
  );
}

export function flatMapCoreOp<T, E, R extends AnyNullaryOp, M>(
  op: Op<T, E, [], M>,
  bind: (value: T) => R,
): Op<InferOpOk<R>, E | InferOpErr<R>, [], MergeMeta<M, InferOpMeta<R>>> {
  const mapped: Op<InferOpOk<R>, E | InferOpErr<R>, [], MergeMeta<M, InferOpMeta<R>>> = makeCoreOp<
    InferOpOk<R>,
    E | InferOpErr<R> | UnhandledException,
    MergeMeta<M, InferOpMeta<R>>
  >(
    function* () {
      const first: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        drive(op, context),
      );

      if (first.isErr()) return yield* first;

      const second: Result<
        InferOpOk<R>,
        InferOpErr<R> | UnhandledException
      > = yield* new SuspendInstruction((context) => drive(bind(first.value), context));

      if (second.isErr()) return yield* second;
      return second.value;
    },
    createDefaultHooks(() => mapped),
  );

  return mapped;
}

export function tapCoreOp<T, E, R, M>(
  op: Op<T, E, [], M>,
  observe: (value: T) => R,
): Op<T, E | InferOpErr<R>, [], MergeMeta<M, InferOpMeta<R>>> {
  return makeCoreOp<T, E | InferOpErr<R> | UnhandledException, MergeMeta<M, InferOpMeta<R>>>(
    function* () {
      const source: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        drive(op, context),
      );

      if (source.isErr()) return yield* source;

      const observed: R = yield* new SuspendInstruction(() =>
        Promise.resolve(observe(source.value)),
      );
      const observedOp: AnyNullaryOp | undefined = yield* new SuspendInstruction(() =>
        Promise.resolve(coerceToNullaryOp(observed)),
      );

      if (!observedOp) return source.value;

      const observedResult: Result<unknown, InferOpErr<R> | UnhandledException> =
        yield* new SuspendInstruction((context) => drive(observedOp, context));

      if (observedResult.isErr()) return yield* observedResult;
      return source.value;
    },
    {
      ...createDefaultHooks(() => tapCoreOp(op, observe)),
      inner: op,
      rebuild: (newInner) =>
        tapCoreOp(
          // SAFETY: rebuild callbacks are only used with the `inner` op they declared in this hook.
          unsafeCoerce<Op<T, E, [], M>>(newInner),
          observe,
        ),
    },
  );
}

export function tapErrCoreOp<T, E, R, M>(
  op: Op<T, E, [], M>,
  observe: (error: E) => R,
): Op<T, E | InferOpErr<R>, [], MergeMeta<M, InferOpMeta<R>>> {
  return makeCoreOp<T, E | InferOpErr<R> | UnhandledException, MergeMeta<M, InferOpMeta<R>>>(
    function* () {
      const source: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        drive(op, context),
      );

      if (source.isOk()) return source.value;
      const sourceError = source.error;

      if (UnhandledException.is(sourceError)) return yield* sourceError;

      const observed: R = yield* new SuspendInstruction(() =>
        Promise.resolve(observe(sourceError)),
      );
      const observedOp: AnyNullaryOp | undefined = yield* new SuspendInstruction(() =>
        Promise.resolve(coerceToNullaryOp(observed)),
      );

      if (!observedOp) return yield* source;

      const observedResult: Result<T, InferOpErr<R> | UnhandledException> =
        yield* new SuspendInstruction((context) => drive(observedOp, context));

      if (observedResult.isErr()) return yield* observedResult;
      return yield* source;
    },
    {
      ...createDefaultHooks(() => tapErrCoreOp(op, observe)),
      inner: op,
      rebuild: (newInner) =>
        tapErrCoreOp(
          // SAFETY: rebuild callbacks are only used with the `inner` op they declared in this hook
          unsafeCoerce<Op<T, E, [], M>>(newInner),
          observe,
        ),
      rebuildForTimeout: tapErrCoreRebuildForTimeout(observe),
    },
  );
}

export function mapErrCoreOp<T, E, E2, M>(
  op: Op<T, E, [], M>,
  transform: (error: E) => E2,
): Op<T, E2, [], M> {
  return makeCoreOp<T, E2 | UnhandledException, M>(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        drive(op, context),
      );

      if (result.isOk()) return result.value;

      const sourceError = result.error;
      if (UnhandledException.is(sourceError)) return yield* sourceError;

      const mapped: E2 = yield* new SuspendInstruction(() =>
        Promise.resolve(transform(sourceError)),
      );

      return yield* Result.err(mapped);
    },
    {
      ...createDefaultHooks(() => mapErrCoreOp(op, transform)),
      inner: op,
      rebuild: (newInner) =>
        mapErrCoreOp(
          // SAFETY: rebuild callbacks are only used with the `inner` op they declared in this hook
          unsafeCoerce<Op<T, E, [], M>>(newInner),
          transform,
        ),
      rebuildForTimeout: mapErrCoreRebuildForTimeout(transform),
    },
  );
}

export function recoverCoreOp<T, E, ECaught extends E, R, M>(
  op: Op<T, E, [], M>,
  predicate: (error: E) => error is ECaught,
  handler: (error: ECaught) => R,
): Op<T | InferOpOk<R>, E | InferOpErr<R>, [], MergeMeta<M, InferOpMeta<R>>> {
  return makeCoreOp<
    T | InferOpOk<R>,
    E | InferOpErr<R> | UnhandledException,
    MergeMeta<M, InferOpMeta<R>>
  >(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        drive(op, context),
      );

      if (result.isOk()) return result.value;

      if (UnhandledException.is(result.error)) return yield* result;

      const error = result.error;

      if (!predicate(error)) return yield* Result.err(error);

      const recovered: InferOpOk<R> = yield* new SuspendInstruction(() =>
        Promise.resolve(handler(error)),
      );
      const recoveredOp: AnyNullaryOp | undefined = yield* new SuspendInstruction(() =>
        Promise.resolve(coerceToNullaryOp(recovered)),
      );

      if (!recoveredOp) return recovered;

      const recoveredResult: Result<
        InferOpOk<R>,
        InferOpErr<R> | UnhandledException
      > = yield* new SuspendInstruction((context) => drive(recoveredOp, context));

      if (recoveredResult.isErr()) return yield* recoveredResult;
      return recoveredResult.value;
    },
    {
      ...createDefaultHooks(() => recoverCoreOp(op, predicate, handler)),
      inner: op,
      rebuild: (newInner) =>
        recoverCoreOp(
          // SAFETY: rebuild callbacks are only used with the `inner` op they declared in this hook
          unsafeCoerce<Op<T, E, [], M>>(newInner),
          predicate,
          handler,
        ),
      rebuildForTimeout: recoverCoreRebuildForTimeout<T, E, ECaught, R, M>(predicate, handler),
    },
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
