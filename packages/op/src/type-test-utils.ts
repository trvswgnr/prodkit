export type Assert<T extends true> = T;
export type AssertFalse<T extends false> = T;

export type IsEqual<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
export type IsNotEqual<X, Y> = true extends IsEqual<X, Y> ? false : true;

export type IsTrue<T> = IsEqual<T, true>;
export type IsFalse<T> = IsEqual<T, false>;

export type IsAny<T> = 0 extends 1 & T ? true : false;
export type IsNotAny<T> = true extends IsAny<T> ? false : true;

export type Debug<T> = { [K in keyof T]: T[K] };
export type MergeInsertions<T> = T extends object ? { [K in keyof T]: MergeInsertions<T[K]> } : T;

export type IsAlike<X, Y> = IsEqual<MergeInsertions<X>, MergeInsertions<Y>>;

export type Extends<VALUE, EXPECTED> = EXPECTED extends VALUE ? true : false;
export type IsValidArgs<
  FUNC extends (...args: never[]) => unknown,
  ARGS extends readonly unknown[],
> = ARGS extends Parameters<FUNC> ? true : false;

// oxlint-disable-next-line typescript/no-explicit-any - test utility
export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;
