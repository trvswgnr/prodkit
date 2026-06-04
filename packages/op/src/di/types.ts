import type { Op } from "../index.js";
import type { Dependency } from "./index.js";
import { type Blocking, type NormalizeMeta, type Simplify, type StripEmpty } from "../core/meta.js";

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
