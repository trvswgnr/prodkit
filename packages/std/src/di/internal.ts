// oxlint-disable typescript-eslint/no-explicit-any
import {
  CUSTOM_INSTRUCTION_META,
  NEVER,
  SuspendInstruction,
  createRunContext,
  drive,
  unsafeCoerce,
  type CustomInstruction,
  type RunContext,
} from "@prodkit/op/internal";
import { Op, type EmptyMeta } from "@prodkit/op";
import type { Dependency } from "./index.js";

declare global {
  interface ObjectConstructor {
    hasOwn<T extends object, K extends PropertyKey>(
      object: T,
      key: K,
    ): object is T & Record<K, unknown>;
  }
}

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

export const DI_TOKEN = Symbol("prodkit.std.di.dependency");
export const DI_TAG = "DI";

const DI_ENV_EXTENSION = Symbol("prodkit.std.di.env");
const MISSING_DEPENDENCY = Symbol("prodkit.std.di.missing-dependency");

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

export type LazyBinding<C extends AnyDependency, V = unknown> = {
  readonly _tag: "DependencyLazyBinding";
  readonly dependency: C;
  readonly resolve: () => DependencyValue<C, V>;
};
export type AnyLazyBinding = LazyBinding<AnyDependency>;

type StripEmpty<M> = [M] extends [never] ? {} : M extends EmptyMeta ? {} : M;
type Simplify<T> = T extends object ? { [K in keyof T]: T[K] } : T;
type NormalizeMeta<M> = [M] extends [never]
  ? EmptyMeta
  : M extends EmptyMeta
    ? EmptyMeta
    : M extends object
      ? keyof M extends never
        ? EmptyMeta
        : M
      : M;

export type WithDIMeta<M, R> = Simplify<
  Omit<StripEmpty<M> & {}, "requirements"> & { readonly requirements: R }
>;

export type InferMetaReqs<M> = M extends { readonly requirements: infer R } ? R : never;

export type InferReqs<C> = C extends Op<any, any, infer _A, infer M> ? InferMetaReqs<M> : never;

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

type UpdateProvidedMeta<M, R> = NormalizeMeta<
  Simplify<
    Omit<StripEmpty<M> & {}, "requirements"> &
      ([R] extends [never] ? {} : { readonly requirements: R })
  >
>;

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

  resolve(context: RunContext<readonly unknown[]>): T {
    const env = readEnv(context);
    const value = resolveDependencyValue(env, this.dependency);
    if (value === MISSING_DEPENDENCY) {
      throw new MissingDependencyError(this.dependency.key);
    }
    return unsafeCoerce<T>(value);
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
    Object.hasOwn(value, "_tag") &&
    value._tag === "DependencyBinding"
  );
}

function isDependencyLazyBinding(value: unknown): value is AnyLazyBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "_tag") &&
    value._tag === "DependencyLazyBinding"
  );
}

function dependencyTokenFromEntry(entry: AnyDependency): AnyDependency {
  const ctor = entry.constructor;
  if (typeof ctor !== "function") return entry;

  let current: unknown = ctor;
  while (typeof current === "function") {
    if (
      Object.hasOwn(current, "_tag") &&
      current._tag === DI_TAG &&
      Object.hasOwn(current, "key") &&
      Object.hasOwn(current, DI_TOKEN)
    ) {
      return unsafeCoerce<AnyDependency>(current);
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
  if (env instanceof Map) return unsafeCoerce<Env>(env);
  return new Map();
}

function resolveDependencyValue(env: Env, dependency: AnyDependency): unknown {
  const matchedToken = findProvidedToken(env, dependency);
  if (matchedToken === undefined) return MISSING_DEPENDENCY;

  const matchedValue = env.get(matchedToken);

  if (isDependencyLazyBinding(matchedValue)) {
    const resolved = matchedValue.resolve();
    env.set(matchedToken, resolved);
    return resolved;
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

export function provideOp<
  T,
  E,
  A extends readonly unknown[],
  M,
  const Entries extends readonly UseEntry[],
>(op: Op<T, E, A, M>, entries: Entries): Op<T, E, A, ProvidedMeta<M, Entries>> {
  const provided = Op(function* (...args: A) {
    const result = yield* new SuspendInstruction((context) =>
      drive(op(...args), extendContext(context, entries)),
    );
    if (result.isErr()) return yield* result;
    return result.value;
  });

  return unsafeCoerce<Op<T, E, A, ProvidedMeta<M, Entries>>>(provided);
}
