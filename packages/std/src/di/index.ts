import { NEVER } from "@prodkit/op/internal";
import type { Op as OgOp } from "@prodkit/op";
import { InferErr as InferResultErr } from "better-result";
import {
  DI_TOKEN,
  DI_TAG,
  buildDependencyOp,
  createDependencyOp,
  DependencyReqInstruction,
  type DiOpBase,
  type ConditionalIterable,
  type DependencyCtor,
  type DependencyValue,
  type Binding,
  type LazyBinding,
  type AnyDependency,
  type DependencyReq,
  type InferEmbedErr,
  type EmbedDiOpInstruction,
} from "./internal";

export interface Dependency<T, Name extends string> {
  readonly _tag: typeof DI_TAG;
  readonly key: Name;
  readonly [DI_TOKEN]: T;
}

export namespace DI {
  export type Op<T, E, A extends readonly unknown[], R> = DiOpBase<T, E, A, R> &
    ConditionalIterable<T, E, A, R> & { readonly [DI_TOKEN]: T };
}

export const Op = <Y, T, A extends readonly unknown[]>(
  f: (...args: A) => Generator<Y, T, unknown>,
): DI.Op<
  T,
  InferResultErr<Y> | InferEmbedErr<Y>,
  A,
  Y extends unknown
    ?
        | (Y extends DependencyReqInstruction<unknown, infer R> ? R : never)
        | (Y extends EmbedDiOpInstruction<unknown, unknown, infer R> ? R : never)
    : never
> =>
  createDependencyOp({
    buildOp: (env) => buildDependencyOp(f, env),
    env: new Map(),
    iterable: true,
  });
export type Op<T, E, A extends readonly unknown[], R> = DI.Op<T, E, A, R>;

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

export const provide = <T, E, A extends readonly unknown[], R>(
  op: DI.Op<T, E, A, R>,
  ...entries: Array<
    | Binding<Extract<R, AnyDependency>, DependencyValue<Extract<R, AnyDependency>>>
    | LazyBinding<Extract<R, AnyDependency>, DependencyValue<Extract<R, AnyDependency>>>
  >
): DI.Op<
  T,
  E,
  A,
  Exclude<R, DependencyReq<Extract<R, AnyDependency>> | DependencyReq<Extract<R, AnyDependency>>>
> => op.use(...entries);

export const DI = Object.freeze({
  Op,
  Dependency,
  require,
  singleton,
  scoped,
  provide,
});

type OpLike<T, E, A extends readonly unknown[], R> = OgOp<T, E, A> | DI.Op<T, E, A, R>;
export type InferErr<X> = X extends OpLike<infer _T, infer E, infer _A, infer _R> ? E : never;
export type InferOk<X> = X extends OpLike<infer T, infer _E, infer _A, infer _R> ? T : never;
export type InferArgs<X> = X extends OpLike<infer _T, infer _E, infer A, infer _R> ? A : never;
export type InferReqs<X> = X extends DI.Op<infer _T, infer _E, infer _A, infer R> ? R : never;
