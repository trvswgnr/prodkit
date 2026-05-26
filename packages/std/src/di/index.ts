// oxlint-disable typescript-eslint/no-explicit-any
import { NEVER } from "@prodkit/op/internal";
import type { Op as CoreOp } from "@prodkit/op";
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
  type ProvidedMeta,
  type UseEntry,
  type ValidUseEntries,
} from "./internal.js";

export interface Dependency<T, Name extends string> {
  readonly _tag: typeof DI_TAG;
  readonly key: Name;
  readonly [DI_TOKEN]: T;
}

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
      throw new TypeError("Use DI.require(dependency) to require a dependency binding");
    }
  }

  return DependencyToken;
};

export const require = function* <C extends AnyDependency>(
  dependency: C,
): Generator<
  DependencyReqInstruction<DependencyValue<C>, DependencyReq<C>>,
  DependencyValue<C>,
  unknown
> {
  return yield* new DependencyReqInstruction<DependencyValue<C>, DependencyReq<C>>(dependency);
};

export const singleton = <C extends AnyDependency, V = unknown>(
  dependency: C,
  value: DependencyValue<C, V>,
): Binding<C, V> => ({
  _tag: "DependencyBinding",
  dependency,
  value,
});

export const scoped = <C extends AnyDependency, V = unknown>(
  dependency: C,
  resolve: () => DependencyValue<C, V>,
): LazyBinding<C, V> => ({
  _tag: "DependencyLazyBinding",
  dependency,
  resolve,
});

export const provide = <
  T,
  E,
  A extends readonly unknown[],
  M,
  const Entries extends readonly UseEntry[],
>(
  op: CoreOp<T, E, A, M>,
  ...entries: ValidUseEntries<Entries, import("./internal.js").InferMetaReqs<M>>
): CoreOp<T, E, A, ProvidedMeta<M, Entries>> => provideOp(op, entries);

export const DI = Object.freeze({
  Dependency,
  require,
  singleton,
  scoped,
  provide,
});

type OpLike<T, E, A extends readonly unknown[]> = CoreOp<T, E, A, any>;
export type InferErr<X> = X extends OpLike<infer _T, infer E, infer _A> ? E : never;
export type InferOk<X> = X extends OpLike<infer T, infer _E, infer _A> ? T : never;
export type InferArgs<X> = X extends OpLike<infer _T, infer _E, infer A> ? A : never;
export type InferReqs<X> = import("./internal.js").InferReqs<X>;
