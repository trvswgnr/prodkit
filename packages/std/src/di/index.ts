import { NEVER } from "@prodkit/op/internal";
import type { Op as OgOp } from "@prodkit/op";
import { InferErr as InferResultErr } from "better-result";
import {
  CTX_TOKEN,
  CTX_TAG,
  CtxOpBase,
  ConditionalIterable,
  InferYieldRequirement,
  DistributeRequirement,
  buildContextOp,
  ServiceContextCtor,
  RequireContext,
  Value,
  Provider,
  AnyCtx,
  ContextReq,
  InferEmbedErr,
  createContextOp,
} from "./internal";

export interface DI<T, Name extends string> {
  readonly _tag: typeof CTX_TAG;
  readonly key: Name;
  readonly [CTX_TOKEN]: T;
}

export namespace DI {
  export type Op<T, E, A extends readonly unknown[], R> = CtxOpBase<T, E, A, R> &
    ConditionalIterable<T, E, A, R> & { readonly [CTX_TOKEN]: T };
}

export const DI = Object.freeze({
  Op: <
    Y,
    T,
    A extends readonly unknown[],
    R extends InferYieldRequirement<Y> = DistributeRequirement<InferYieldRequirement<Y>>,
  >(
    f: (...args: A) => Generator<Y, T, unknown>,
  ): DI.Op<T, InferResultErr<Y> | InferEmbedErr<Y>, A, R> =>
    createContextOp<T, InferResultErr<Y> | InferEmbedErr<Y>, A, R>({
      buildOp: (env) => buildContextOp(f, env),
      env: new Map(),
      iterable: true,
    }),
  Service: <const Name extends string>(key: Name): ServiceContextCtor<Name> => {
    class ServiceContext<T> {
      readonly _tag = CTX_TAG;
      readonly key = key;
      readonly [CTX_TOKEN] = NEVER;

      *[Symbol.iterator](): Generator<RequireContext<T, this>, T, unknown> {
        return yield* new RequireContext<T, this>(ServiceContext);
      }

      static readonly _tag = CTX_TAG;
      static readonly key = key;
      static readonly [CTX_TOKEN] = NEVER;
      static of<C extends AnyCtx>(this: C, value: Value<C>): Provider<C> {
        return {
          _tag: "ContextProvider",
          context: this,
          value,
        };
      }

      static *[Symbol.iterator](): Generator<never, never, unknown> {
        throw new TypeError("Use DI.require(service) to require a context binding");
      }
    }

    return ServiceContext;
  },
  require: function* <C extends AnyCtx>(
    context: C,
  ): Generator<RequireContext<Value<C>, ContextReq<C>>, Value<C>, unknown> {
    return yield* new RequireContext<Value<C>, ContextReq<C>>(context);
  },
});

export const Service = DI.Service;
export const require = DI.require;
export const Op = DI.Op;
export type Op<T, E, A extends readonly unknown[], R> = DI.Op<T, E, A, R>;

type OpLike<T, E, A extends readonly unknown[], R> = OgOp<T, E, A> | DI.Op<T, E, A, R>;
export type InferErr<X> = X extends OpLike<infer _T, infer E, infer _A, infer _R> ? E : never;
export type InferOk<X> = X extends OpLike<infer T, infer _E, infer _A, infer _R> ? T : never;
export type InferArgs<X> = X extends OpLike<infer _T, infer _E, infer A, infer _R> ? A : never;
export type InferReqs<X> = X extends DI.Op<infer _T, infer _E, infer _A, infer R> ? R : never;
