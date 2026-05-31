import { NEVER } from "../shared.js";
import type { Op } from "../index.js";
import {
  DI_TAG,
  DI_TOKEN,
  DI_SINGLETON_BINDING,
  DI_LAZY_BINDING,
  InjectInstruction,
  provideOp,
  type AnyDependency,
  type SingletonBinding,
  type DependencyCtor,
  type Deps,
  type DependencyValue,
  type LazyBinding,
  type LazyResolveFn,
  type AnyBinding,
  type ValidProvideEntries,
  type RequiredDepsOfMeta,
  ProvidedMeta,
} from "./internal.js";

/** Phantom-typed dependency token created with {@link Dependency}. */
export interface Dependency<T, Name extends string> {
  readonly _tag: typeof DI_TAG;
  readonly key: Name;
  readonly [DI_TOKEN]: T;
}

/** Creates a dependency token class for `DI.inject` and bindings. */
export const Dependency = <const Name extends string>(key: Name): DependencyCtor<Name> => {
  class DependencyToken<T> {
    readonly _tag = DI_TAG;
    readonly key = key;
    readonly [DI_TOKEN] = NEVER;

    *[Symbol.iterator](): Generator<InjectInstruction<T, this>, T, unknown> {
      return yield* new InjectInstruction<T, this>(DependencyToken);
    }

    static readonly _tag = DI_TAG;
    static readonly key = key;
    static readonly [DI_TOKEN] = NEVER;

    static *[Symbol.iterator](): Generator<never, never, unknown> {
      throw new TypeError("Use DI.inject(dependency) to inject a dependency binding");
    }
  }

  return DependencyToken;
};

/** Yields a bound dependency value from the current run context. */
export const inject = function* <C extends AnyDependency>(
  dependency: C,
): Generator<InjectInstruction<DependencyValue<C>, Deps<C>>, DependencyValue<C>, unknown> {
  return yield* new InjectInstruction<DependencyValue<C>, Deps<C>>(dependency);
};

/** Eager singleton binding for {@link provide}. */
export const singleton = <C extends AnyDependency, V = unknown>(
  dependency: C,
  value: DependencyValue<C, V>,
): SingletonBinding<C, V> => ({
  [DI_SINGLETON_BINDING]: true,
  dependency,
  value,
});

/** Per-run lazy binding resolved when first injected. */
export const scoped = <C extends AnyDependency>(
  dependency: C,
  resolve: LazyResolveFn<C>,
): LazyBinding<C> => ({
  [DI_LAZY_BINDING]: true,
  dependency,
  resolve,
});

/** Satisfies dependency requirements on an op before `.run()`. */
export const provide = <T, E, A, M, const Entries extends readonly AnyBinding[]>(
  op: Op<T, E, A, M>,
  ...entries: ValidProvideEntries<Entries, RequiredDepsOfMeta<M>>
): Op<T, E, A, ProvidedMeta<M, Entries>> => provideOp(op, entries);

/** Namespace object for dependency injection helpers. */
export const DI = Object.freeze({
  Dependency,
  inject,
  singleton,
  scoped,
  provide,
});

export type { RequiredDeps } from "./internal.js";
