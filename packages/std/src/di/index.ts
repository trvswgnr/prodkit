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

export class MissingContextError extends Error {
  override readonly name = "MissingContextError";
  readonly _tag = "MissingContextError";
  readonly key: string;
  constructor(key: string) {
    super(`Missing context: ${key}`);
    this.key = key;
  }

  static is(value: unknown): value is MissingContextError {
    return value instanceof MissingContextError;
  }
}

type RunResult<T, E, A extends readonly unknown[]> = ReturnType<Op<T, E, A>["run"]>;

const CONTEXT_TOKEN = Symbol("prodkit.std.di.context");
const CONTEXT_REQUIREMENT = Symbol("prodkit.std.di.requirement");
const WITH_CONTEXT = Symbol("prodkit.std.di.withContext");

function unsafeCoerce<T>(value: unknown): T {
  return value as T;
}

type AnyContext = Ctx<unknown, string>;

export type Value<C> = C extends abstract new (...args: never[]) => Ctx<infer T, string>
  ? T
  : C extends Ctx<infer T, string>
    ? T
    : never;
export type Provider<C extends AnyContext> = {
  readonly _tag: "ContextProvider";
  readonly context: C;
  readonly value: Value<C>;
};
type AnyProvider = Provider<AnyContext>;

export type InferContextRequirements<C> =
  C extends Ctx.Op<infer _T, infer _E, infer _A, infer R> ? R : never;

export class ContextInstruction<_T, _R> {
  readonly _tag = "ContextInstruction";
  readonly [CONTEXT_REQUIREMENT]: _R;
  readonly context: AnyContext;

  constructor(context: AnyContext) {
    this[CONTEXT_REQUIREMENT] = unsafeCoerce<_R>(undefined);
    this.context = context;
  }
}

export interface Ctx<T, Name extends string = string> {
  readonly _tag: "Context";
  readonly key: Name;
  readonly [CONTEXT_TOKEN]: T;
}

export namespace Ctx {
  export type Op<T, E, A extends readonly unknown[], R> = _WithContext<T, E, A, R>;
}

export const Ctx = Object.freeze({
  Op: withContext,
  Service: createContext,
  require: requireContext,
});

type ContextBuilder<Name extends string> = {
  readonly _tag: "Context";
  readonly key: Name;
  readonly [CONTEXT_TOKEN]: never;

  of<C extends AnyContext>(this: C, value: Value<C>): Provider<C>;
  new <T>(): Ctx<T, Name>;
};

type _Requirement<C> = C extends abstract new (...args: never[]) => infer I ? I : C;

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
    static of<C extends AnyContext>(this: C, value: Value<C>): Provider<C> {
      return {
        _tag: "ContextProvider",
        context: this,
        value,
      };
    }

    static *[Symbol.iterator](): Generator<never, never, unknown> {
      throw new TypeError("Use Ctx.require(Requirement) to require a context");
    }
  }

  return unsafeCoerce<ContextBuilder<Name>>(ServiceContext);
}

function* requireContext<C extends AnyContext>(
  context: C,
): Generator<ContextInstruction<Value<C>, _Requirement<C>>, Value<C>, unknown> {
  return unsafeCoerce<Value<C>>(yield new ContextInstruction<Value<C>, _Requirement<C>>(context));
}

export class WithContextInstruction<T, E, R> {
  readonly _tag = "WithContextInstruction";
  readonly op: Ctx.Op<T, E, [], R>;

  constructor(op: Ctx.Op<T, E, [], R>) {
    this.op = op;
  }
}

export type Requirement<P> = P extends Provider<infer C> ? _Requirement<C> : never;

type AnyNullaryWithContext = Ctx.Op<unknown, unknown, [], unknown>;
type AnyWithContext = Ctx.Op<unknown, unknown, readonly unknown[], unknown>;
type AnyNullaryOp = Op<unknown, unknown, []>;
type Env = ReadonlyMap<AnyContext, unknown>;

type InferContext<Y> =
  | (Y extends ContextInstruction<unknown, infer R> ? R : never)
  | (Y extends WithContextInstruction<unknown, unknown, infer R> ? R : never);
type SimplifyRequirement<R> = R extends unknown ? R : never;

type InferContextErr<Y> = Y extends WithContextInstruction<unknown, infer E, unknown> ? E : never;

type ObserverContext<R> = R extends Ctx.Op<unknown, unknown, [], infer RContext> ? RContext : never;
type ObserverErr<R> =
  R extends Op<unknown, infer E, []>
    ? E
    : R extends Ctx.Op<unknown, infer E, [], unknown>
      ? E
      : never;
type ObserverOk<R> =
  R extends Op<infer T, unknown, []>
    ? T
    : R extends Ctx.Op<infer T, unknown, [], unknown>
      ? T
      : Awaited<R>;

type MaybeOp<T, E> = Op<T, E, []> | Ctx.Op<T, E, [], unknown>;

export interface WithContextBase<T, E, A extends readonly unknown[], R> {
  readonly _tag: "WithContext";
  readonly [WITH_CONTEXT]: true;

  (...args: A): Ctx.Op<T, E, [], R>;

  /** Runs a fully-provided wrapper with the same argument shape as the wrapped `Op`. */
  readonly run: [R] extends [never] ? (...args: A) => RunResult<T, E, A> : never;

  /** Provides services and removes them from the remaining requirement type. */
  use<const Providers extends readonly AnyProvider[]>(
    ...providers: Providers
  ): Ctx.Op<T, E, A, Exclude<R, Requirement<Providers[number]>>>;

  withRetry(policy?: RetryPolicy): Ctx.Op<T, E, A, R>;
  withTimeout(timeoutMs: number): Ctx.Op<T, E | TimeoutError, A, R>;
  withSignal(signal: AbortSignal): Ctx.Op<T, E, A, R>;
  withRelease(release: (value: T) => unknown): Ctx.Op<T, E, A, R>;

  on(event: "enter", initialize: (ctx: EnterContext<A>) => unknown): Ctx.Op<T, E, A, R>;
  on(event: "exit", finalize: (ctx: ExitContext<T, E, A>) => unknown): Ctx.Op<T, E, A, R>;

  map<U>(transform: (value: T) => U): Ctx.Op<Awaited<U>, E, A, R>;
  mapErr<E2>(transform: (error: E) => E2): Ctx.Op<T, E2, A, R>;

  flatMap<U, E2, R2>(bind: (value: T) => Ctx.Op<U, E2, [], R2>): Ctx.Op<U, E | E2, A, R | R2>;
  flatMap<U, E2>(bind: (value: T) => Op<U, E2, []>): Ctx.Op<U, E | E2, A, R>;

  tap<RObserved>(
    observe: (value: T) => RObserved,
  ): Ctx.Op<T, E | ObserverErr<RObserved>, A, R | ObserverContext<RObserved>>;
  tapErr<RObserved>(
    observe: (error: E) => RObserved,
  ): Ctx.Op<T, E | ObserverErr<RObserved>, A, R | ObserverContext<RObserved>>;

  recover<ECaught extends E, RRecovered>(
    predicate: (error: E) => error is ECaught,
    handler: (error: ECaught) => RRecovered,
  ): Ctx.Op<
    T | ObserverOk<RRecovered>,
    Exclude<E, ECaught> | ObserverErr<RRecovered>,
    A,
    R | ObserverContext<RRecovered>
  >;
  recover<RRecovered>(
    predicate: (error: E) => boolean,
    handler: (error: E) => RRecovered,
  ): Ctx.Op<
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

interface ContextOpState<T, E, A extends readonly unknown[]> {
  readonly buildOp: (env: Env) => Op<T, E, A>;
  readonly env: Env;
  readonly iterable: boolean;
}

interface ContextOpRuntime<T, E, A extends readonly unknown[]> {
  toOp(env?: Env): Op<T, E, A>;
}

function isContextInstruction(value: unknown): value is ContextInstruction<unknown, AnyContext> {
  return value instanceof ContextInstruction;
}

function isWithContextInstruction(
  value: unknown,
): value is WithContextInstruction<unknown, unknown, unknown> {
  return value instanceof WithContextInstruction;
}

function isWithContext(value: unknown): value is AnyWithContext {
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
  return lower(unsafeCoerce<AnyNullaryWithContext>(value), env);
}

function lower<T, E, A extends readonly unknown[]>(
  value: Ctx.Op<T, E, A, unknown>,
  env: Env,
): Op<T, E, A> {
  return unsafeCoerce<ContextOpRuntime<T, E, A>>(value).toOp(env);
}

function asOp<T, E, A extends readonly unknown[]>(op: Op<T, E, A>): Op<T, E, A> {
  return unsafeCoerce<Op<T, E, A>>(op);
}

function makeWithContext<T, E, A extends readonly unknown[], R>(
  state: ContextOpState<T, E, A>,
): Ctx.Op<T, E, A, R> {
  const rebuild = <T2, E2, A2 extends readonly unknown[], R2>(
    next: ContextOpState<T2, E2, A2>,
  ): Ctx.Op<T2, E2, A2, R2> => makeWithContext<T2, E2, A2, R2>(next);

  const mapBuiltOp = <T2, E2>(
    mapOp: (op: Op<T, E, A>, env: Env) => Op<T2, E2, A>,
  ): Ctx.Op<T2, E2, A, R> =>
    rebuild<T2, E2, A, R>({
      ...state,
      buildOp: (env) => mapOp(state.buildOp(env), env),
    });

  const self = Object.assign(
    (...args: A) =>
      rebuild<T, E, [], R>({
        buildOp: (env) => unsafeCoerce(asOp(state.buildOp(env))(...args)),
        env: state.env,
        iterable: true,
      }),
    {
      _tag: "WithContext" as const,
      [WITH_CONTEXT]: true as const,
      toOp: (envOverride?: Env) => state.buildOp(envOverride ?? state.env),
      run: (...args: A) => asOp(state.buildOp(state.env)).run(...args),
      use: (...providers: readonly AnyProvider[]) =>
        rebuild<T, E, A, R>({
          ...state,
          env: providers.reduce(
            (env, provider) => extendEnv(env, provider.context, provider.value),
            state.env,
          ),
        }),
      withRetry: (policy?: RetryPolicy) =>
        mapBuiltOp((op) => unsafeCoerce<Op<T, E, A>>(asOp(op).withRetry(policy))),
      withTimeout: (timeoutMs: number) =>
        mapBuiltOp((op) => unsafeCoerce<Op<T, E, A>>(asOp(op).withTimeout(timeoutMs))),
      withSignal: (signal: AbortSignal) =>
        mapBuiltOp((op) => unsafeCoerce<Op<T, E, A>>(asOp(op).withSignal(signal))),
      withRelease: (release: (value: T) => unknown) =>
        mapBuiltOp((op) => unsafeCoerce<Op<T, E, A>>(asOp(op).withRelease(release))),
      on: (event: OpLifecycleHook, handler: unknown) =>
        mapBuiltOp((op) =>
          unsafeCoerce<Op<T, E, A>>(asOp(op).on(unsafeCoerce(event), unsafeCoerce(handler))),
        ),
      map: (transform: (value: T) => unknown) =>
        mapBuiltOp((op) => unsafeCoerce<Op<T, E, A>>(asOp(op).map(transform))),
      mapErr: (transform: (error: E) => unknown) =>
        mapBuiltOp((op) => unsafeCoerce<Op<T, E, A>>(asOp(op).mapErr(transform))),
      flatMap: (bind: (value: T) => MaybeOp<unknown, unknown>) =>
        mapBuiltOp((op, env) =>
          unsafeCoerce<Op<T, E, A>>(
            asOp(op).flatMap((value) =>
              unsafeCoerce<AnyNullaryOp>(resolveObserved(bind(value), env)),
            ),
          ),
        ),
      tap: (observe: (value: T) => unknown) =>
        mapBuiltOp((op, env) =>
          unsafeCoerce<Op<T, E, A>>(asOp(op).tap((value) => resolveObserved(observe(value), env))),
        ),
      tapErr: (observe: (error: E) => unknown) =>
        mapBuiltOp((op, env) =>
          unsafeCoerce<Op<T, E, A>>(
            asOp(op).tapErr((error) => resolveObserved(observe(error), env)),
          ),
        ),
      recover: (predicate: (error: E) => boolean, handler: (error: E) => unknown) =>
        mapBuiltOp((op, env) =>
          unsafeCoerce<Op<T, E, A>>(
            asOp(op).recover(unsafeCoerce(predicate), (error) =>
              resolveObserved(handler(unsafeCoerce<E>(error)), env),
            ),
          ),
        ),
    },
  );

  if (state.iterable) {
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

  return unsafeCoerce<Ctx.Op<T, E, A, R>>(self);
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

          throw new MissingContextError(instruction.context.key);
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
>(f: (...args: A) => Generator<Y, T, unknown>): Ctx.Op<T, InferErr<Y> | InferContextErr<Y>, A, R> {
  return makeWithContext<T, InferErr<Y> | InferContextErr<Y>, A, R>({
    buildOp: (env) => buildContextOp(f, env),
    env: new Map(),
    iterable: f.length === 0,
  });
}
