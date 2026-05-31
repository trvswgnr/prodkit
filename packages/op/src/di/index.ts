import { NEVER } from "../shared.js";
import type { Op } from "../index.js";
import {
  DI_TAG,
  DI_TOKEN,
  DependencyReqInstruction,
  provideOp,
  type AnyDependency,
  type Binding,
  type DependencyCtor,
  type DependencyReq,
  type DependencyValue,
  type LazyBinding,
  type ScopedResolveFn,
  type UseEntry,
  type ValidUseEntries,
  type InferMetaReqs,
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

    *[Symbol.iterator](): Generator<DependencyReqInstruction<T, this>, T, unknown> {
      return yield* new DependencyReqInstruction<T, this>(DependencyToken);
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
): Generator<
  DependencyReqInstruction<DependencyValue<C>, DependencyReq<C>>,
  DependencyValue<C>,
  unknown
> {
  return yield* new DependencyReqInstruction<DependencyValue<C>, DependencyReq<C>>(dependency);
};

/** Eager singleton binding for {@link provide}. */
export const singleton = <C extends AnyDependency, V = unknown>(
  dependency: C,
  value: DependencyValue<C, V>,
): Binding<C, V> => ({
  _tag: "DependencyBinding",
  dependency,
  value,
});

/** Per-run scoped binding resolved when first injected. */
export const scoped = <C extends AnyDependency>(
  dependency: C,
  resolve: ScopedResolveFn<C>,
): LazyBinding<C> => ({
  _tag: "DependencyLazyBinding",
  dependency,
  resolve,
});

/** Satisfies dependency requirements on an op before `.run()`. */
export const provide = <T, E, A, M, const Entries extends readonly UseEntry[]>(
  op: Op<T, E, A, M>,
  ...entries: ValidUseEntries<Entries, InferMetaReqs<M>>
): Op<T, E, A, ProvidedMeta<M, Entries>> => provideOp(op, entries);

/** Namespace object for dependency injection helpers. */
export const DI = Object.freeze({
  Dependency,
  inject,
  singleton,
  scoped,
  provide,
});

export type InferErr<X> = X extends Op<infer _T, infer E, infer _A> ? E : never;
export type InferOk<X> = X extends Op<infer T, infer _E, infer _A> ? T : never;
export type InferArgs<X> = X extends Op<infer _T, infer _E, infer A> ? A : never;
export type { InferReqs } from "./internal.js";
