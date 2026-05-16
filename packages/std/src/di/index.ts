import type { InferErr } from "better-result";
import {
  Op,
  TimeoutError,
  type EnterContext,
  type ExitContext,
  type OpLifecycleHook,
  type RetryPolicy,
} from "@prodkit/op";
import type { AbortSignal } from "../platform.js";

type RunResult<T, E, A extends readonly unknown[]> = ReturnType<WrappedOp<T, E, A>["run"]>;

const CONTEXT_TOKEN = Symbol("prodkit.std.di.context");
const CONTEXT_REQUIREMENT = Symbol("prodkit.std.di.requirement");
const WITH_CONTEXT = Symbol("prodkit.std.di.withContext");

function unsafeCoerce<T>(value: unknown): T {
  return value as T;
}

export type AnyContext = Context<unknown, string>;

export type ContextValue<C> = C extends abstract new (...args: never[]) => Context<infer T, string>
  ? T
  : C extends Context<infer T, string>
    ? T
    : never;
type ContextRequirement<C> = C extends abstract new (...args: never[]) => infer I ? I : C;
type AnyProvider = Context.Provider<AnyContext>;

export type InferContextRequirements<C> =
  C extends Context.Op<infer _T, infer _E, infer _A, infer R> ? R : never;

export class ContextInstruction<_T, _R> {
  readonly _tag = "ContextInstruction";
  readonly [CONTEXT_REQUIREMENT]: _R;
  readonly context: AnyContext;

  constructor(context: AnyContext) {
    this[CONTEXT_REQUIREMENT] = unsafeCoerce<_R>(undefined);
    this.context = context;
  }
}

export interface Context<T, Name extends string = string> {
  readonly _tag: "Context";
  readonly key: Name;
  readonly [CONTEXT_TOKEN]: T;
  [Symbol.iterator](): Generator<ContextInstruction<T, this>, T, unknown>;
}

export namespace Context {
  export type Op<T, E, A extends readonly unknown[], R> = _WithContext<T, E, A, R>;
  export type Provider<C extends AnyContext> = {
    readonly _tag: "ContextProvider";
    readonly context: C;
    readonly value: ContextValue<C>;
  };
  export type ProviderRequirement<P> = P extends Provider<infer C> ? ContextRequirement<C> : never;
}

type ContextBuilder<Name extends string> = {
  readonly _tag: "Context";
  readonly key: Name;
  readonly [CONTEXT_TOKEN]: never;
  [Symbol.iterator](): Generator<never, never, unknown>;
  of<C extends AnyContext>(this: C, value: ContextValue<C>): Context.Provider<C>;
  new <T>(): Context<T, Name>;
};

export interface ContextFactory {
  <const Name extends string>(key: Name): ContextBuilder<Name>;
  require<C extends AnyContext>(
    context: C,
  ): Generator<
    ContextInstruction<ContextValue<C>, ContextRequirement<C>>,
    ContextValue<C>,
    unknown
  >;
  Op: typeof withContext;
}

function createContext<const Name extends string>(key: Name): ContextBuilder<Name> {
  class ServiceContext<T> {
    readonly _tag = "Context";
    readonly key = key;
    readonly [CONTEXT_TOKEN] = unsafeCoerce<T>(undefined);

    *[Symbol.iterator](): Generator<ContextInstruction<T, this>, T, unknown> {
      return unsafeCoerce<T>(
        yield new ContextInstruction<T, this>(unsafeCoerce<AnyContext>(ServiceContext)),
      );
    }

    static readonly _tag = "Context";
    static readonly key = key;
    static readonly [CONTEXT_TOKEN] = unsafeCoerce<never>(undefined);
    static of<C extends AnyContext>(this: C, value: ContextValue<C>): Context.Provider<C> {
      return {
        _tag: "ContextProvider",
        context: this,
        value,
      };
    }
    static *[Symbol.iterator](): Generator<never, never, unknown> {
      throw new TypeError("Use Context.require(Service) to require a service");
    }
  }

  return unsafeCoerce<ContextBuilder<Name>>(ServiceContext);
}

function requireContext<C extends AnyContext>(
  context: C,
): Generator<ContextInstruction<ContextValue<C>, ContextRequirement<C>>, ContextValue<C>, unknown> {
  return (function* () {
    return unsafeCoerce<ContextValue<C>>(
      yield new ContextInstruction<ContextValue<C>, ContextRequirement<C>>(context),
    );
  })();
}

export const Context: ContextFactory = Object.assign(createContext, {
  require: requireContext,
  Op: withContext,
});

export class WithContextInstruction<T, E, R> {
  readonly _tag = "WithContextInstruction";
  readonly op: Context.Op<T, E, [], R>;

  constructor(op: Context.Op<T, E, [], R>) {
    this.op = op;
  }
}

type AnyNullaryWithContext = Context.Op<unknown, unknown, [], unknown>;
type AnyNullaryOp = Op<unknown, unknown, []>;
type Env = ReadonlyMap<AnyContext, unknown>;

type WrappedOp<T, E, A extends readonly unknown[]> = Op<T, E, A>;

type InferContext<Y> =
  | (Y extends ContextInstruction<unknown, infer R> ? R : never)
  | (Y extends WithContextInstruction<unknown, unknown, infer R> ? R : never);
type SimplifyRequirement<R> = R extends unknown ? R : never;

type InferContextErr<Y> = Y extends WithContextInstruction<unknown, infer E, unknown> ? E : never;

type ObserverContext<R> =
  R extends Context.Op<unknown, unknown, [], infer RContext> ? RContext : never;
type ObserverErr<R> =
  R extends Op<unknown, infer E, []>
    ? E
    : R extends Context.Op<unknown, infer E, [], unknown>
      ? E
      : never;
type ObserverOk<R> =
  R extends Op<infer T, unknown, []>
    ? T
    : R extends Context.Op<infer T, unknown, [], unknown>
      ? T
      : Awaited<R>;

type MaybeOp<T, E> = Op<T, E, []> | Context.Op<T, E, [], unknown>;

export interface WithContextBase<T, E, A extends readonly unknown[], R> {
  readonly _tag: "WithContext";
  readonly [WITH_CONTEXT]: true;

  (...args: A): Context.Op<T, E, [], R>;

  /** Lowers a fully-provided wrapper back to a normal `Op`. */
  toOp(this: Context.Op<T, E, A, never>): Op<T, E, A>;

  /** Runs a fully-provided wrapper with the same argument shape as the wrapped `Op`. */
  readonly run: [R] extends [never] ? (...args: A) => RunResult<T, E, A> : never;

  /** Provides services and removes them from the remaining requirement type. */
  provide<const Providers extends readonly AnyProvider[]>(
    ...providers: Providers
  ): Context.Op<T, E, A, Exclude<R, Context.ProviderRequirement<Providers[number]>>>;

  withRetry(policy?: RetryPolicy): Context.Op<T, E, A, R>;
  withTimeout(timeoutMs: number): Context.Op<T, E | TimeoutError, A, R>;
  withSignal(signal: AbortSignal): Context.Op<T, E, A, R>;
  withRelease(release: (value: T) => unknown): Context.Op<T, E, A, R>;

  on(event: "enter", initialize: (ctx: EnterContext<A>) => unknown): Context.Op<T, E, A, R>;
  on(event: "exit", finalize: (ctx: ExitContext<T, E, A>) => unknown): Context.Op<T, E, A, R>;

  map<U>(transform: (value: T) => U): Context.Op<Awaited<U>, E, A, R>;
  mapErr<E2>(transform: (error: E) => E2): Context.Op<T, E2, A, R>;

  flatMap<U, E2, R2>(
    bind: (value: T) => Context.Op<U, E2, [], R2>,
  ): Context.Op<U, E | E2, A, R | R2>;
  flatMap<U, E2>(bind: (value: T) => Op<U, E2, []>): Context.Op<U, E | E2, A, R>;

  tap<RObserved>(
    observe: (value: T) => RObserved,
  ): Context.Op<T, E | ObserverErr<RObserved>, A, R | ObserverContext<RObserved>>;
  tapErr<RObserved>(
    observe: (error: E) => RObserved,
  ): Context.Op<T, E | ObserverErr<RObserved>, A, R | ObserverContext<RObserved>>;

  recover<ECaught extends E, RRecovered>(
    predicate: (error: E) => error is ECaught,
    handler: (error: ECaught) => RRecovered,
  ): Context.Op<
    T | ObserverOk<RRecovered>,
    Exclude<E, ECaught> | ObserverErr<RRecovered>,
    A,
    R | ObserverContext<RRecovered>
  >;
  recover<RRecovered>(
    predicate: (error: E) => boolean,
    handler: (error: E) => RRecovered,
  ): Context.Op<
    T | ObserverOk<RRecovered>,
    E | ObserverErr<RRecovered>,
    A,
    R | ObserverContext<RRecovered>
  >;
}

type _WithContext<T, E, A extends readonly unknown[], R> = (WithContextBase<T, E, A, R> &
  (A extends []
    ? {
        [Symbol.iterator](): Generator<WithContextInstruction<T, E, R>, T, unknown>;
      }
    : {})) & { [WITH_CONTEXT]: true };

interface WithContextState<T, E, A extends readonly unknown[]> {
  readonly build: (env: Env) => Op<T, E, A>;
  readonly env: Env;
  readonly makeIterable?: ((env: Env) => AnyNullaryOp) | undefined;
}

function isContextInstruction(value: unknown): value is ContextInstruction<unknown, AnyContext> {
  return value instanceof ContextInstruction;
}

function isWithContextInstruction(
  value: unknown,
): value is WithContextInstruction<unknown, unknown, unknown> {
  return value instanceof WithContextInstruction;
}

function isWithContext(value: unknown): value is AnyNullaryWithContext {
  return (
    typeof value === "function" &&
    value !== null &&
    WITH_CONTEXT in value &&
    value[WITH_CONTEXT] === true
  );
}

function extendEnv(env: Env, context: AnyContext, value: unknown): Env {
  const next = new Map(env);
  next.set(context, value);
  return next;
}

function resolveObserved(value: unknown, env: Env): unknown {
  if (!isWithContext(value)) return value;
  return lower(value, env);
}

function lower<T, E, A extends readonly unknown[]>(
  value: Context.Op<T, E, A, unknown>,
  env: Env,
): Op<T, E, A> {
  return (value as unknown as { toOp: (env?: Env) => Op<T, E, A> }).toOp(env);
}

function wrapped<T, E, A extends readonly unknown[]>(op: Op<T, E, A>): WrappedOp<T, E, A> {
  return unsafeCoerce<WrappedOp<T, E, A>>(op);
}

function makeWithContext<T, E, A extends readonly unknown[], R>(
  state: WithContextState<T, E, A>,
): Context.Op<T, E, A, R> {
  const self = Object.assign(
    (...args: A) =>
      makeWithContext<T, E, [], R>({
        build: (env) => unsafeCoerce(wrapped(state.build(env))(...args)),
        env: state.env,
        makeIterable: (env) => unsafeCoerce<AnyNullaryOp>(wrapped(state.build(env))(...args)),
      }),
    {
      _tag: "WithContext" as const,
      [WITH_CONTEXT]: true as const,
      toOp: (envOverride?: Env) => state.build(envOverride ?? state.env),
      run: (...args: A) => wrapped(state.build(state.env)).run(...args),
      provide: (...providers: readonly AnyProvider[]) =>
        makeWithContext({
          ...state,
          env: providers.reduce(
            (env, provider) => extendEnv(env, provider.context, provider.value),
            state.env,
          ),
        }),
      withRetry: (policy?: RetryPolicy) =>
        makeWithContext({
          ...state,
          build: (env) => unsafeCoerce<Op<T, E, A>>(wrapped(state.build(env)).withRetry(policy)),
        }),
      withTimeout: (timeoutMs: number) =>
        makeWithContext({
          ...state,
          build: (env) =>
            unsafeCoerce<Op<T, E, A>>(wrapped(state.build(env)).withTimeout(timeoutMs)),
        }),
      withSignal: (signal: AbortSignal) =>
        makeWithContext({
          ...state,
          build: (env) => unsafeCoerce<Op<T, E, A>>(wrapped(state.build(env)).withSignal(signal)),
        }),
      withRelease: (release: (value: T) => unknown) =>
        makeWithContext({
          ...state,
          build: (env) => unsafeCoerce<Op<T, E, A>>(wrapped(state.build(env)).withRelease(release)),
        }),
      on: (event: OpLifecycleHook, handler: unknown) =>
        makeWithContext({
          ...state,
          build: (env) =>
            unsafeCoerce<Op<T, E, A>>(
              wrapped(state.build(env)).on(unsafeCoerce(event), unsafeCoerce(handler)),
            ),
        }),
      map: (transform: (value: T) => unknown) =>
        makeWithContext({
          ...state,
          build: (env) => unsafeCoerce<Op<T, E, A>>(wrapped(state.build(env)).map(transform)),
        }),
      mapErr: (transform: (error: E) => unknown) =>
        makeWithContext({
          ...state,
          build: (env) => unsafeCoerce<Op<T, E, A>>(wrapped(state.build(env)).mapErr(transform)),
        }),
      flatMap: (bind: (value: T) => MaybeOp<unknown, unknown>) =>
        makeWithContext({
          ...state,
          build: (env) =>
            unsafeCoerce<Op<T, E, A>>(
              wrapped(state.build(env)).flatMap((value) =>
                unsafeCoerce<AnyNullaryOp>(resolveObserved(bind(value), env)),
              ),
            ),
        }),
      tap: (observe: (value: T) => unknown) =>
        makeWithContext({
          ...state,
          build: (env) =>
            unsafeCoerce<Op<T, E, A>>(
              wrapped(state.build(env)).tap((value) => resolveObserved(observe(value), env)),
            ),
        }),
      tapErr: (observe: (error: E) => unknown) =>
        makeWithContext({
          ...state,
          build: (env) =>
            unsafeCoerce<Op<T, E, A>>(
              wrapped(state.build(env)).tapErr((error) => resolveObserved(observe(error), env)),
            ),
        }),
      recover: (predicate: (error: E) => boolean, handler: (error: E) => unknown) =>
        makeWithContext({
          ...state,
          build: (env) =>
            unsafeCoerce<Op<T, E, A>>(
              wrapped(state.build(env)).recover(unsafeCoerce(predicate), (error) =>
                resolveObserved(handler(unsafeCoerce<E>(error)), env),
              ),
            ),
        }),
    },
  );

  if (state.makeIterable !== undefined) {
    Object.assign(self, {
      [Symbol.iterator]: function* (): Generator<WithContextInstruction<T, E, R>, T, unknown> {
        return unsafeCoerce<T>(
          yield unsafeCoerce<WithContextInstruction<T, E, R>>(
            new WithContextInstruction(unsafeCoerce<AnyNullaryWithContext>(self)),
          ),
        );
      },
    });
  }

  return unsafeCoerce<Context.Op<T, E, A, R>>(self);
}

function buildContextOp<Y, T, A extends readonly unknown[]>(
  f: (...args: A) => Generator<Y, T, unknown>,
  env: Env,
): Op<T, InferErr<Y> | InferContextErr<Y>, A> {
  return unsafeCoerce<Op<T, InferErr<Y> | InferContextErr<Y>, A>>(
    Op(function* (...args: A) {
      const iterator = f(...args);
      let input: unknown;

      while (true) {
        const step = iterator.next(input);
        if (step.done) return step.value;

        const instruction = step.value;
        if (isContextInstruction(instruction)) {
          if (env.has(instruction.context)) {
            input = env.get(instruction.context);
            continue;
          }

          throw new Error(`Missing context: ${instruction.context.key}`);
        }

        if (isWithContextInstruction(instruction)) {
          input = yield* lower(instruction.op, env);
          continue;
        }

        input = yield unsafeCoerce<never>(instruction);
      }
    }),
  );
}

function withContext<
  Y,
  T,
  A extends readonly unknown[],
  R extends InferContext<Y> = SimplifyRequirement<InferContext<Y>>,
>(
  f: (...args: A) => Generator<Y, T, unknown>,
): Context.Op<T, InferErr<Y> | InferContextErr<Y>, A, R> {
  const makeIterable =
    f.length === 0 ? (env: Env) => unsafeCoerce<AnyNullaryOp>(buildContextOp(f, env)) : undefined;

  return makeWithContext<T, InferErr<Y> | InferContextErr<Y>, A, R>({
    build: (env) => buildContextOp(f, env),
    env: new Map(),
    makeIterable,
  });
}
