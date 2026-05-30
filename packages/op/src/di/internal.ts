import { fromGenFn } from "../builders.js";
import { SuspendInstruction } from "../core/instructions.js";
import { createRunContext, drive } from "../core/runtime.js";
import {
  CUSTOM_INSTRUCTION_META,
  type AsArgs,
  type Blocking,
  type CustomInstruction,
  type EmptyMeta,
  type NormalizeMeta,
  type RunContext,
  type Simplify,
  type StripEmpty,
} from "../core/types.js";
import { NEVER, hasOwn, isPromiseLike, unsafeCoerce } from "../shared.js";
import type { Op } from "../index.js";
import type { Dependency } from "./index.js";
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

export class AlreadyProvidedError extends Error {
  override readonly name = "AlreadyProvidedError";
  readonly _tag = "AlreadyProvidedError";
  readonly key: string;

  constructor(key: string) {
    super(`${key} was already provided`);
    this.key = key;
  }

  static is(value: unknown): value is AlreadyProvidedError {
    return value instanceof AlreadyProvidedError;
  }
}

export const DI_TOKEN = Symbol("prodkit.op.di.dependency");
export const DI_TAG = "DI";

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

export type Binding<C extends AnyDependency, V = unknown> = {
  readonly _tag: "DependencyBinding";
  readonly dependency: C;
  readonly value: DependencyValue<C, V>;
};
export type AnyBinding = Binding<AnyDependency>;

export type ScopedResolveFn<C extends AnyDependency> = (
  signal: AbortSignal,
) => DependencyValue<C> | PromiseLike<DependencyValue<C>>;

export type LazyBinding<C extends AnyDependency> = {
  readonly _tag: "DependencyLazyBinding";
  readonly dependency: C;
  readonly resolve: ScopedResolveFn<C>;
};
export type AnyLazyBinding = LazyBinding<AnyDependency>;

export type WithDIMeta<M, R> = [R] extends [never]
  ? NormalizeMeta<Omit<StripEmpty<M>, "deps">>
  : Simplify<Omit<StripEmpty<M>, "deps"> & { deps: Blocking<R> }>;

export type InferMetaReqs<M> = M extends { deps: Blocking<infer R> } ? R : never;

export type InferReqs<C> =
  C extends Op<unknown, unknown, infer _A, infer M> ? InferMetaReqs<M> : never;

export type DependencyReq<C> = C extends { readonly prototype: infer I } ? I : C;

type SatisfiedDirectReq<P, R> = R extends unknown ? (P extends R ? R : never) : never;

export type UseEntry = AnyBinding | AnyLazyBinding | AnyDependency;

export type UseReq<P, R = unknown> =
  P extends Binding<infer C>
    ? DependencyReq<C>
    : P extends LazyBinding<infer C>
      ? DependencyReq<C>
      : P extends AnyDependency
        ? SatisfiedDirectReq<P, R>
        : never;

export type ProvidedReq<Entries extends readonly UseEntry[], R> = Exclude<
  R,
  UseReq<Entries[number], R>
>;

type InvalidUseReq<Entries extends readonly UseEntry[], R> = Exclude<UseReq<Entries[number], R>, R>;

export type ValidUseEntries<Entries extends readonly UseEntry[], R> = [
  InvalidUseReq<Entries, R>,
] extends [never]
  ? Entries
  : never;

type UpdateProvidedMeta<M, R> = [R] extends [never]
  ? NormalizeMeta<Omit<StripEmpty<M>, "deps">>
  : Simplify<Omit<StripEmpty<M>, "deps"> & { deps: Blocking<R> }>;

export type ProvidedMeta<M, Entries extends readonly UseEntry[]> = UpdateProvidedMeta<
  M,
  ProvidedReq<Entries, InferMetaReqs<M>>
>;

export class DependencyReqInstruction<T, R> implements CustomInstruction<
  T,
  WithDIMeta<EmptyMeta, R>
> {
  readonly _tag = "DependencyReqInstruction";
  readonly [CUSTOM_INSTRUCTION_META]: WithDIMeta<EmptyMeta, R> = NEVER;
  readonly dependency: AnyDependency;

  constructor(dependency: AnyDependency) {
    this.dependency = dependency;
  }

  resolve(context: RunContext<readonly unknown[]>): T | PromiseLike<T> {
    assertNotAborted(context.signal);
    const env = readEnv(context);
    const value = resolveDependencyValue(env, this.dependency, context.signal);
    if (value === MISSING_DEPENDENCY) {
      throw new MissingDependencyError(this.dependency.key);
    }
    if (isPromiseLike(value)) {
      return value.then((resolved) =>
        // SAFETY: lazy binding resolution is checked before coercion.
        unsafeCoerce(resolved),
      );
    }
    // SAFETY: resolved dependency values are typed at the instruction boundary.
    return unsafeCoerce(value);
  }

  *[Symbol.iterator](): Generator<this, T, unknown> {
    return (yield this) as T;
  }

  static is(value: unknown): value is DependencyReqInstruction<unknown, AnyDependency> {
    return value instanceof DependencyReqInstruction;
  }
}

type Env = Map<AnyDependency, unknown>;

function isDependencyBinding(value: unknown): value is AnyBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwn(value, "_tag") &&
    value._tag === "DependencyBinding"
  );
}

function isDependencyLazyBinding(value: unknown): value is AnyLazyBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    hasOwn(value, "_tag") &&
    value._tag === "DependencyLazyBinding"
  );
}

function dependencyTokenFromEntry(entry: AnyDependency): AnyDependency {
  const ctor = entry.constructor;
  if (typeof ctor !== "function") return entry;

  let current: unknown = ctor;
  while (typeof current === "function") {
    if (
      hasOwn(current, "_tag") &&
      current._tag === DI_TAG &&
      hasOwn(current, "key") &&
      hasOwn(current, DI_TOKEN)
    ) {
      // SAFETY: prototype walk finds the DI token constructor when present.
      return unsafeCoerce(current);
    }
    current = Object.getPrototypeOf(current);
  }

  return entry;
}

function sameDependencyKey(a: AnyDependency, b: AnyDependency): boolean {
  return a === b || a.key === b.key;
}

function findProvidedToken(env: Env, dependency: AnyDependency): AnyDependency | undefined {
  for (const token of env.keys()) {
    if (sameDependencyKey(token, dependency)) return token;
  }
  return undefined;
}

function withDependencyBinding(env: Env, dependency: AnyDependency, value: unknown): Env {
  if (findProvidedToken(env, dependency) !== undefined) {
    throw new AlreadyProvidedError(dependency.key);
  }
  env.set(dependency, value);
  return env;
}

function withDependencyEntry(env: Env, entry: UseEntry): Env {
  if (isDependencyBinding(entry)) {
    return withDependencyBinding(env, entry.dependency, entry.value);
  }
  if (isDependencyLazyBinding(entry)) {
    return withDependencyBinding(env, entry.dependency, entry);
  }
  return withDependencyBinding(env, dependencyTokenFromEntry(entry), entry);
}

function readEnv(context: RunContext<readonly unknown[]>): Env {
  const env = context.extensions.get(DI_ENV_EXTENSION);
  // SAFETY: RunContext.extensions stores the DI env map under an internal key.
  if (env instanceof Map) return unsafeCoerce(env);
  return new Map();
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Aborted");
}

function assertNotAborted(
  signal: AbortSignal,
): asserts signal is AbortSignal & { readonly aborted: false } {
  if (signal.aborted) {
    throw abortReason(signal);
  }
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

function resolveDependencyValue(
  env: Env,
  dependency: AnyDependency,
  signal: AbortSignal,
): unknown | PromiseLike<unknown> {
  const matchedToken = findProvidedToken(env, dependency);
  if (matchedToken === undefined) return MISSING_DEPENDENCY;

  const matchedValue = env.get(matchedToken);

  if (isDependencyLazyBinding(matchedValue)) {
    const lazyBinding = matchedValue;
    const produced = lazyBinding.resolve(signal);
    if (isPromiseLike(produced)) {
      const inflight = awaitWithSignalAbort(produced, signal).then(
        (resolved) => {
          env.set(matchedToken, resolved);
          return resolved;
        },
        (error) => {
          env.set(matchedToken, lazyBinding);
          return Promise.reject(error);
        },
      );
      env.set(matchedToken, inflight);
      return inflight;
    }
    env.set(matchedToken, produced);
    return produced;
  }

  return matchedValue;
}

function extendContext(
  context: RunContext<readonly unknown[]>,
  entries: readonly UseEntry[],
): RunContext<readonly unknown[]> {
  const parentEnv = readEnv(context);
  const env = entries.reduce(
    (current, entry) => withDependencyEntry(current, entry),
    new Map(parentEnv),
  );
  const extensions = new Map(context.extensions);
  extensions.set(DI_ENV_EXTENSION, env);
  return createRunContext(context.signal, context.args, extensions);
}

export function provideOp<T, E, A, M, const Entries extends readonly UseEntry[]>(
  op: Op<T, E, A, M>,
  entries: Entries,
): Op<T, E, A, ProvidedMeta<M, Entries>> {
  const provided = fromGenFn(function* (...args: AsArgs<A>) {
    const result = yield* new SuspendInstruction((context) =>
      drive(op(...args), extendContext(context, entries)),
    );
    if (result.isErr()) return yield* result;
    return result.value;
  });

  // SAFETY: provideOp preserves the inner op type while updating dependency metadata.
  return unsafeCoerce(provided);
}
