import { hasOwn } from "../runtime";

export type OkLike<T> = ({ readonly ok: true } | { readonly status: "ok" }) & {
  readonly value: T;
};

export type ErrLike<E> = ({ readonly ok: false } | { readonly status: "error" }) & {
  readonly error: E;
};

export type InferOk<R> = R extends OkLike<infer T> ? T : never;
export type InferErr<R> = R extends ErrLike<infer E> ? E : never;

export type Result<T, E> = OkLike<T> | ErrLike<E>;

export function ok<T, E = never>(value: T): Result<T, E> {
  return Object.freeze({ ok: true, status: "ok", value });
}

export function err<E, T = never>(error: E): Result<T, E> {
  return Object.freeze({ ok: false, status: "error", error });
}

export function isOk<T, E>(result: Result<T, E>): result is OkLike<T> {
  if (hasOwn(result, "ok")) return result.ok;
  return result.status === "ok";
}

export function isErr<T, E>(result: Result<T, E>): result is ErrLike<E> {
  if (hasOwn(result, "ok")) return !result.ok;
  return result.status === "error";
}

export const Result = {
  ok,
  err,
  isOk,
  isErr,
};
