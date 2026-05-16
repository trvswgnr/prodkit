import type { InferErr, Result, UnhandledException } from "better-result";
import {
  Op,
  TimeoutError,
  type EnterContext,
  type ExitContext,
  type OpLifecycleHook,
  type RetryPolicy,
} from "@prodkit/op";
import { hasBrand, NEVER, unsafeCoerce, type AbortSignalLike } from "@prodkit/op/internal";
import type { Ctx } from "./index.js";

export class MissingContextError extends Error {
  override readonly name = "MissingContextError";
  readonly _tag = "MissingContextError";
  readonly key: string;
  constructor(key: string) {
    super(`${key} is required but not provided`);
    this.key = key;
  }

  static is(value: unknown): value is MissingContextError {
    return value instanceof MissingContextError;
  }
}

export type RunResult<T, E> = Promise<Result<T, E | UnhandledException>>;

export const CTX_TOKEN = Symbol("prodkit.std.di.context");
const CTX_REQUIREMENT_TOKEN = Symbol("prodkit.std.di.requirement");
const CTX_OP_TOKEN = Symbol("prodkit.std.di.ctxOp");
export const CTX_TAG = "Ctx";

export type AnyCtx = Ctx<unknown, string>;

export type Value<C> = C extends abstract new (...args: never[]) => Ctx<infer T, string>
  ? T
  : C extends Ctx<infer T, string>
    ? T
    : never;

export type Provider<C extends AnyCtx> = {
  readonly _tag: "ContextProvider";
  readonly context: C;
  readonly value: Value<C>;
};
export type AnyProvider = Provider<AnyCtx>;

export type InferContextRequirements<C> =
  C extends Ctx.Op<infer _T, infer _E, infer _A, infer R> ? R : never;

/** Yielded by `Ctx.require` and bare service classes to ask the runtime for an env binding. */
export class RequireContext<_T, _R> {
  readonly _tag = "RequireContext";
  readonly [CTX_REQUIREMENT_TOKEN]: { _T: _T; _R: _R };
  readonly context: AnyCtx;

  constructor(context: AnyCtx) {
    this[CTX_REQUIREMENT_TOKEN] = NEVER;
    this.context = context;
  }

  // oxlint-disable-next-line typescript/no-explicit-any
  *[Symbol.iterator](): Generator<this, any, unknown> {
    return yield this;
  }
}

export type ConditionalIterable<T, E, A extends readonly unknown[], R> = A extends []
  ? { [Symbol.iterator](): Generator<EmbedCtxOp<T, E, R>, T, unknown> }
  : {};

export type ServiceContextCtor<Name extends string> = {
  readonly _tag: typeof CTX_TAG;
  readonly key: Name;
  readonly [CTX_TOKEN]: never;

  of<C extends AnyCtx>(this: C, value: Value<C>): Provider<C>;
  new <T>(): Ctx<T, Name>;
};

/** Constructor-or-token metatype used in requirement set `R` for a service key class. */
export type ContextReq<C> = C extends abstract new (...args: never[]) => infer I ? I : C;

/** Yield wrapping a nested nullary `Ctx.Op` so the parent generator can `yield*` it. */
export class EmbedCtxOp<T, E, R> {
  readonly _tag = "EmbedCtxOp";
  readonly op: Ctx.Op<T, E, [], R>;

  constructor(op: Ctx.Op<T, E, [], R>) {
    this.op = op;
  }

  // oxlint-disable-next-line typescript/no-explicit-any
  *[Symbol.iterator](): Generator<this, any, unknown> {
    return yield this;
  }
}

export type Requirement<P> = P extends Provider<infer C> ? ContextReq<C> : never;

export type AnyNullaryCtxOp = Ctx.Op<unknown, unknown, [], unknown>;
export type AnyCtxOp = Ctx.Op<unknown, unknown, readonly unknown[], unknown>;
export type AnyNullaryOp = Op<unknown, unknown, []>;
export type Env = ReadonlyMap<AnyCtx, unknown>;

export type InferYieldRequirement<Y> =
  | (Y extends RequireContext<unknown, infer R> ? R : never)
  | (Y extends EmbedCtxOp<unknown, unknown, infer R> ? R : never);
export type DistributeRequirement<R> = R extends unknown ? R : never;

export type InferEmbedErr<Y> = Y extends EmbedCtxOp<unknown, infer E, unknown> ? E : never;

export type OpLike<T, E> = Op<T, E, []> | Ctx.Op<T, E, [], unknown>;

export type ObserverReq<X> = X extends Ctx.Op<unknown, unknown, [], infer R> ? R : never;
export type ObserverErr<X> = X extends OpLike<unknown, infer E> ? E : never;
export type ObserverOk<X> = X extends OpLike<infer T, unknown> ? T : Awaited<X>;

export interface CtxOpBase<T, E, A extends readonly unknown[], R> {
  readonly _tag: "CtxOp";
  readonly [CTX_OP_TOKEN]: true;

  (...args: A): Ctx.Op<T, E, [], R>;

  /** Runs a fully-provided wrapper with the same argument shape as the wrapped `Op`. */
  readonly run: [R] extends [never] ? (...args: A) => RunResult<T, E> : never;

  /** Provides services and removes them from the remaining requirement type. */
  use<const Providers extends readonly AnyProvider[]>(
    ...providers: Providers
  ): Ctx.Op<T, E, A, Exclude<R, Requirement<Providers[number]>>>;

  withRetry(policy?: RetryPolicy): Ctx.Op<T, E, A, R>;
  withTimeout(timeoutMs: number): Ctx.Op<T, E | TimeoutError, A, R>;
  withSignal(signal: AbortSignalLike): Ctx.Op<T, E, A, R>;
  withRelease(release: (value: T) => unknown): Ctx.Op<T, E, A, R>;

  on(event: "enter", initialize: (ctx: EnterContext<A>) => unknown): Ctx.Op<T, E, A, R>;
  on(event: "exit", finalize: (ctx: ExitContext<T, E, A>) => unknown): Ctx.Op<T, E, A, R>;

  map<U>(transform: (value: T) => U): Ctx.Op<Awaited<U>, E, A, R>;
  mapErr<E2>(transform: (error: E) => E2): Ctx.Op<T, E2, A, R>;

  flatMap<U, E2, R2>(bind: (value: T) => Ctx.Op<U, E2, [], R2>): Ctx.Op<U, E | E2, A, R | R2>;
  flatMap<U, E2>(bind: (value: T) => Op<U, E2, []>): Ctx.Op<U, E | E2, A, R>;

  tap<RObserved>(
    observe: (value: T) => RObserved,
  ): Ctx.Op<T, E | ObserverErr<RObserved>, A, R | ObserverReq<RObserved>>;
  tapErr<RObserved>(
    observe: (error: E) => RObserved,
  ): Ctx.Op<T, E | ObserverErr<RObserved>, A, R | ObserverReq<RObserved>>;

  recover<ECaught extends E, RRecovered>(
    predicate: (error: E) => error is ECaught,
    handler: (error: ECaught) => RRecovered,
  ): Ctx.Op<
    T | ObserverOk<RRecovered>,
    Exclude<E, ECaught> | ObserverErr<RRecovered>,
    A,
    R | ObserverReq<RRecovered>
  >;
  recover<RRecovered>(
    predicate: (error: E) => boolean,
    handler: (error: E) => RRecovered,
  ): Ctx.Op<
    T | ObserverOk<RRecovered>,
    E | ObserverErr<RRecovered>,
    A,
    R | ObserverReq<RRecovered>
  >;
}

export interface CtxOpState<T, E, A extends readonly unknown[]> {
  readonly buildOp: (env: Env) => Op<T, E, A>;
  readonly env: Env;
  readonly iterable: boolean;
}

export interface CtxOpRuntime<T, E, A extends readonly unknown[]> {
  toOp(env?: Env): Op<T, E, A>;
}

export type CtxOpCallable<T, E, A extends readonly unknown[], R> = ((
  ...args: A
) => Ctx.Op<T, E, [], R>) &
  CtxOpRuntime<T, E, A> & {
    readonly _tag: "CtxOp";
    readonly [CTX_OP_TOKEN]: true;
    readonly run: (...args: A) => RunResult<T, E>;
    readonly use: (...providers: readonly AnyProvider[]) => Ctx.Op<T, E, A, unknown>;
    readonly withRetry: (policy?: RetryPolicy) => Ctx.Op<T, E, A, R>;
    readonly withTimeout: (timeoutMs: number) => Ctx.Op<T, E | TimeoutError, A, R>;
    readonly withSignal: (signal: AbortSignalLike) => Ctx.Op<T, E, A, R>;
    readonly withRelease: (release: (value: T) => unknown) => Ctx.Op<T, E, A, R>;
    readonly on: (event: OpLifecycleHook, handler: unknown) => Ctx.Op<T, E, A, R>;
    readonly map: (transform: (value: T) => unknown) => Ctx.Op<unknown, E, A, R>;
    readonly mapErr: (transform: (error: E) => unknown) => Ctx.Op<T, unknown, A, R>;
    readonly flatMap: (
      bind: (value: T) => OpLike<unknown, unknown>,
    ) => Ctx.Op<unknown, unknown, A, unknown>;
    readonly tap: (observe: (value: T) => unknown) => Ctx.Op<T, unknown, A, unknown>;
    readonly tapErr: (observe: (error: E) => unknown) => Ctx.Op<T, unknown, A, unknown>;
    readonly recover: (
      predicate: (error: E) => boolean,
      handler: (error: E) => unknown,
    ) => Ctx.Op<unknown, unknown, A, unknown>;
  };

function isContextRequirementInstruction(value: unknown): value is RequireContext<unknown, AnyCtx> {
  return value instanceof RequireContext;
}

function isEmbeddedContextOperationInstruction(
  value: unknown,
): value is EmbedCtxOp<unknown, unknown, unknown> {
  return value instanceof EmbedCtxOp;
}

function isContextOperation(value: unknown): value is AnyCtxOp {
  return hasBrand(value, CTX_OP_TOKEN);
}

function withContextBinding(env: Env, context: AnyCtx, value: unknown): Env {
  const nextEnv = new Map(env);
  nextEnv.set(context, value);
  return nextEnv;
}

function toRuntimeOp<T, E, A extends readonly unknown[]>(
  value: Ctx.Op<T, E, A, unknown>,
  env: Env,
): Op<T, E, A> {
  return unsafeCoerce<CtxOpRuntime<T, E, A>>(value).toOp(env);
}

function toRuntimeNullaryOp(value: AnyCtxOp, env: Env): AnyNullaryOp {
  return toRuntimeOp(unsafeCoerce<AnyNullaryCtxOp>(value), env);
}

function materializeContextAwareReturn(value: unknown, env: Env): unknown {
  if (!isContextOperation(value)) return value;
  return toRuntimeNullaryOp(value, env);
}

function runWithState<T, E, A extends readonly unknown[]>(
  state: CtxOpState<T, E, A>,
  args: A,
): RunResult<T, E> {
  return state.buildOp(state.env).run(...args);
}

function invokeWithState<T, E, A extends readonly unknown[]>(
  state: CtxOpState<T, E, A>,
  env: Env,
  args: A,
): Op<T, E, []> {
  return state.buildOp(env)(...args);
}

function recreateContextOp<T, E, A extends readonly unknown[], R>(
  state: CtxOpState<T, E, A>,
): Ctx.Op<T, E, A, R> {
  return createContextOp<T, E, A, R>(state);
}

function mapContextOp<T, E, A extends readonly unknown[], R, TOut, EOut>(
  state: CtxOpState<T, E, A>,
  mapOp: (op: Op<T, E, A>, env: Env) => Op<TOut, EOut, A>,
): Ctx.Op<TOut, EOut, A, R> {
  return recreateContextOp<TOut, EOut, A, R>({
    ...state,
    buildOp: (env) => mapOp(state.buildOp(env), env),
  });
}

function applyProviders<T, E, A extends readonly unknown[], R>(
  state: CtxOpState<T, E, A>,
  providers: readonly AnyProvider[],
): Ctx.Op<T, E, A, R> {
  return recreateContextOp<T, E, A, R>({
    ...state,
    env: providers.reduce(
      (env, provider) => withContextBinding(env, provider.context, provider.value),
      state.env,
    ),
  });
}

function asCtxOp<T, E, A extends readonly unknown[], R>(
  value: CtxOpCallable<T, E, A, R>,
): Ctx.Op<T, E, A, R> {
  return unsafeCoerce<Ctx.Op<T, E, A, R>>(value);
}

function buildIterableFacade<T, E, R>(
  self: CtxOpCallable<T, E, [], R>,
): {
  [Symbol.iterator](): Generator<EmbedCtxOp<T, E, R>, T, unknown>;
} {
  return {
    [Symbol.iterator]: function* (): Generator<EmbedCtxOp<T, E, R>, T, unknown> {
      return yield* new EmbedCtxOp(asCtxOp<T, E, [], R>(self));
    },
  };
}

function toFlatMapOpLike(value: OpLike<unknown, unknown>, env: Env): AnyNullaryOp {
  return isContextOperation(value) ? toRuntimeNullaryOp(value, env) : value;
}

export function createContextOp<T, E, A extends readonly unknown[], R>(
  state: CtxOpState<T, E, A>,
): Ctx.Op<T, E, A, R> {
  const lift = <TOut, EOut>(
    mapOp: (op: Op<T, E, A>, env: Env) => Op<TOut, EOut, A>,
  ): Ctx.Op<TOut, EOut, A, R> => mapContextOp(state, mapOp);

  const self: CtxOpCallable<T, E, A, R> = Object.assign(
    (...args: A) =>
      recreateContextOp<T, E, [], R>({
        buildOp: (env) => invokeWithState(state, env, args),
        env: state.env,
        iterable: true,
      }),
    {
      _tag: "CtxOp" as const,
      [CTX_OP_TOKEN]: true as const,
      toOp: (envOverride?: Env) => state.buildOp(envOverride ?? state.env),
      run: (...args: A) => runWithState(state, args),
      use: (...providers: readonly AnyProvider[]) => applyProviders(state, providers),
      withRetry: (policy?: RetryPolicy) => lift((op) => op.withRetry(policy)),
      withTimeout: (timeoutMs: number) => lift((op) => op.withTimeout(timeoutMs)),
      withSignal: (signal: AbortSignalLike) => lift((op) => op.withSignal(signal)),
      withRelease: (release: (value: T) => unknown) => lift((op) => op.withRelease(release)),
      on: (event: OpLifecycleHook, handler: unknown) =>
        lift((op) => op.on(event as "enter", handler as never)),
      map: (transform: (value: T) => unknown) => lift((op) => op.map(transform)),
      mapErr: (transform: (error: E) => unknown) => lift((op) => op.mapErr(transform)),
      flatMap: (bind: (value: T) => OpLike<unknown, unknown>) =>
        lift((op, env) => op.flatMap((value) => toFlatMapOpLike(bind(value), env))),
      tap: (observe: (value: T) => unknown) =>
        lift((op, env) => op.tap((value) => materializeContextAwareReturn(observe(value), env))),
      tapErr: (observe: (error: E) => unknown) =>
        lift((op, env) => op.tapErr((error) => materializeContextAwareReturn(observe(error), env))),
      recover: (predicate: (error: E) => boolean, handler: (error: E) => unknown) =>
        lift((op, env) =>
          op.recover(predicate, (error) => materializeContextAwareReturn(handler(error), env)),
        ),
    },
  );

  if (state.iterable) {
    Object.assign(self, buildIterableFacade(unsafeCoerce<CtxOpCallable<T, E, [], R>>(self)));
  }

  return asCtxOp(self);
}

export function buildContextOp<Y, T, A extends readonly unknown[]>(
  program: (...args: A) => Generator<Y, T, unknown>,
  env: Env,
): Op<T, InferErr<Y> | InferEmbedErr<Y>, A> {
  return unsafeCoerce(
    Op(function* (...args: A) {
      const iterator = program(...args);
      let input: unknown;

      while (true) {
        const step = iterator.next(input);
        if (step.done) return step.value;

        const yielded = step.value;

        if (isContextRequirementInstruction(yielded)) {
          if (env.has(yielded.context)) {
            input = env.get(yielded.context);
            continue;
          }

          throw new MissingContextError(yielded.context.key);
        }

        if (isEmbeddedContextOperationInstruction(yielded)) {
          input = yield* toRuntimeOp(yielded.op, env);
          continue;
        }

        input = yield yielded as never;
      }
    }),
  );
}
