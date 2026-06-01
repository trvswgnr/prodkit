import { fromGenFn } from "../builders.js";
import { SuspendInstruction } from "../core/instructions.js";
import { createRunContext, driveInterruptOnAbort } from "../core/runtime.js";
import type { AsArgs } from "../core/plan/surface.js";
import { CUSTOM_INSTRUCTION_META, type CustomInstruction } from "../core/instructions.js";
import {
  type Blocking,
  type EmptyMeta,
  type NormalizeMeta,
  type Simplify,
  type StripEmpty,
} from "../core/meta.js";
import type { RunContext } from "../core/runtime.js";
import { NEVER, hasBrand, isPromiseLike, unsafeCoerce } from "../shared.js";
import type { Op } from "../index.js";
import type { Dependency } from "./index.js";
/** Binding failure when an injected dependency was not provided for the run. */
export class MissingDependencyError extends Error {
  override readonly name = "MissingDependencyError";
  readonly _tag = "MissingDependencyError";
  readonly key: string;

  constructor(key: string) {
    super(`${key} is required but was not provided`);
    this.key = key;
  }

  static is(value: unknown): value is MissingDependencyError {
    return value instanceof MissingDependencyError;
  }
}

/** Binding failure when the same dependency token is provided more than once. */
export class DuplicateDependencyError extends Error {
  override readonly name = "DuplicateDependencyError";
  readonly _tag = "DuplicateDependencyError";
  readonly key: string;

  constructor(key: string) {
    super(`${key} was provided more than once`);
    this.key = key;
  }

  static is(value: unknown): value is DuplicateDependencyError {
    return value instanceof DuplicateDependencyError;
  }
}

export const DI_TOKEN = Symbol("prodkit.op.di.dependency");
export const DI_TAG = "DI";
export const DI_SINGLETON_BINDING: unique symbol = Symbol("prodkit.op.di.singleton-binding");
export const DI_LAZY_BINDING: unique symbol = Symbol("prodkit.op.di.lazy-binding");

const DI_ENV_EXTENSION = Symbol("prodkit.op.di.env");
const MISSING_DEPENDENCY = Symbol("prodkit.op.di.missing-dependency");

export type AnyDependency = Dependency<unknown, string>;

export interface DependencyCtor<Name extends string> {
  readonly _tag: typeof DI_TAG;
  readonly key: Name;
  readonly [DI_TOKEN]: never;

  new <T>(): Dependency<T, Name>;
}

export type DependencyValue<C, V = unknown> = C extends abstract new (
  ...args: never[]
) => Dependency<infer T, string>
  ? T & V
  : C extends Dependency<infer T, string>
    ? T & V
    : never;

export type SingletonBinding<C extends AnyDependency, V = unknown> = {
  readonly [DI_SINGLETON_BINDING]: true;
  readonly dependency: C;
  readonly value: DependencyValue<C, V>;
};
export type AnySingletonBinding = SingletonBinding<AnyDependency>;

export type LazyResolveFn<C extends AnyDependency> = (
  signal: AbortSignal,
) => DependencyValue<C> | PromiseLike<DependencyValue<C>>;

export type LazyBinding<C extends AnyDependency> = {
  readonly [DI_LAZY_BINDING]: true;
  readonly dependency: C;
  readonly resolve: LazyResolveFn<C>;
};
export type AnyLazyBinding = LazyBinding<AnyDependency>;

export type WithDIMeta<M, R> = [R] extends [never]
  ? NormalizeMeta<Omit<StripEmpty<M>, "deps">>
  : Simplify<Omit<StripEmpty<M>, "deps"> & { deps: Blocking<R> }>;

export type RequiredDepsOfMeta<M> = M extends { deps: Blocking<infer Required> } ? Required : never;

/** Unsatisfied dependency tokens blocking `.run()` on an op. */
export type RequiredDeps<C> =
  C extends Op<infer _T, infer _E, infer _A, infer M> ? RequiredDepsOfMeta<M> : never;

export type Deps<C> = C extends abstract new (...args: never[]) => infer I ? I : C;

export type AnyBinding = AnySingletonBinding | AnyLazyBinding;

export type DepsOf<P extends AnyBinding> =
  P extends SingletonBinding<infer C> ? Deps<C> : P extends LazyBinding<infer C> ? Deps<C> : never;

export type RemainingRequiredDeps<Entries extends readonly AnyBinding[], R> = Exclude<
  R,
  DepsOf<Entries[number]>
>;

type ExcessProvidedDeps<Entries extends readonly AnyBinding[], R> = Exclude<
  DepsOf<Entries[number]>,
  R
>;

export type ValidProvideBindings<Bindings extends readonly AnyBinding[], R> = [
  ExcessProvidedDeps<Bindings, R>,
] extends [never]
  ? Bindings
  : never;

type UpdateProvidedMeta<M, R> = [R] extends [never]
  ? NormalizeMeta<Omit<StripEmpty<M>, "deps">>
  : Simplify<Omit<StripEmpty<M>, "deps"> & { deps: Blocking<R> }>;

export type ProvidedMeta<M, Entries extends readonly AnyBinding[]> = UpdateProvidedMeta<
  M,
  RemainingRequiredDeps<Entries, RequiredDepsOfMeta<M>>
>;

export class InjectInstruction<T, D> implements CustomInstruction<T, WithDIMeta<EmptyMeta, D>> {
  readonly _tag = "InjectInstruction";
  readonly [CUSTOM_INSTRUCTION_META]: WithDIMeta<EmptyMeta, D> = NEVER;
  readonly dependency: AnyDependency;

  constructor(dependency: AnyDependency) {
    this.dependency = dependency;
  }

  resolve(context: RunContext<readonly unknown[]>): T | PromiseLike<T> {
    if (context.signal.aborted) {
      throw abortReason(context.signal);
    }

    const env = readEnv(context);
    const value = resolveInjectedValue(env, this.dependency, context.signal);

    if (value === MISSING_DEPENDENCY) {
      throw new MissingDependencyError(this.dependency.key);
    }

    if (isPromiseLike(value)) {
      return value.then((resolved) =>
        // SAFETY: lazy binding resolution is checked before coercion
        unsafeCoerce(resolved),
      );
    }

    // SAFETY: resolved dependency values are typed at the instruction boundary
    return unsafeCoerce(value);
  }

  *[Symbol.iterator](): Generator<this, T, unknown> {
    // SAFETY: InjectInstruction is a CustomInstruction and its yield type is the same as its resolve type
    return unsafeCoerce(yield this);
  }

  static is(value: unknown): value is InjectInstruction<unknown, AnyDependency> {
    return value instanceof InjectInstruction;
  }
}

function isLazyBinding(value: unknown): value is AnyLazyBinding {
  return hasBrand(value, DI_LAZY_BINDING);
}

/** Slot identity is token class reference; `key` is diagnostic only (ADR 0010). */
function isMatchingDependency(a: AnyDependency, b: AnyDependency): boolean {
  return a === b;
}

type Env = Map<AnyDependency, DependencyValue<AnyDependency>>;

function findProvidedToken(env: Env, dependency: AnyDependency): AnyDependency | undefined {
  for (const token of env.keys()) {
    if (isMatchingDependency(token, dependency)) return token;
  }
  return undefined;
}

function withProvisionEntry(env: Env, entry: AnyBinding): Env {
  if (findProvidedToken(env, entry.dependency) !== undefined) {
    throw new DuplicateDependencyError(entry.dependency.key);
  }
  const value = hasBrand(entry, DI_SINGLETON_BINDING) ? entry.value : entry;
  env.set(entry.dependency, value);
  return env;
}

function readEnv(context: RunContext<readonly unknown[]>): Env {
  const env = context.extensions.get(DI_ENV_EXTENSION);
  if (env instanceof Map) return env;
  return new Map();
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Aborted");
}

function awaitWithSignalAbort<T>(suspended: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(suspended).then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function resolveInjectedValue(
  env: Env,
  dependency: AnyDependency,
  signal: AbortSignal,
): unknown | PromiseLike<unknown> {
  const matchedToken = findProvidedToken(env, dependency);
  if (matchedToken === undefined) return MISSING_DEPENDENCY;

  const matchedValue = env.get(matchedToken);
  if (!isLazyBinding(matchedValue)) return matchedValue;

  const produced = matchedValue.resolve(signal);

  if (!isPromiseLike(produced)) {
    env.set(matchedToken, produced);
    return produced;
  }

  const inflight = awaitWithSignalAbort(produced, signal).then(
    (resolved) => {
      env.set(matchedToken, resolved);
      return resolved;
    },
    (error) => {
      env.set(matchedToken, matchedValue);
      return Promise.reject(error);
    },
  );

  env.set(matchedToken, inflight);
  return inflight;
}

function extendContext(
  context: RunContext<readonly unknown[]>,
  bindings: readonly AnyBinding[],
): RunContext<readonly unknown[]> {
  const parentEnv = readEnv(context);
  const env = bindings.reduce(
    (current, entry) => withProvisionEntry(current, entry),
    new Map(parentEnv),
  );
  const extensions = new Map(context.extensions);
  extensions.set(DI_ENV_EXTENSION, env);
  return createRunContext(context.signal, context.args, extensions);
}

export function provideOp<T, E, A, M, const Bindings extends readonly AnyBinding[]>(
  op: Op<T, E, A, M>,
  bindings: Bindings,
): Op<T, E, A, ProvidedMeta<M, Bindings>> {
  const provided = fromGenFn(function* (...args: AsArgs<A>) {
    const result = yield* new SuspendInstruction(
      (context) => driveInterruptOnAbort(op(...args), extendContext(context, bindings)),
      true,
    );
    if (result.isErr()) return yield* result;
    return result.value;
  });

  // SAFETY: provideOp preserves the inner op type while updating dependency metadata.
  return unsafeCoerce(provided);
}
