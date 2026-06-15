import type { ExitContext } from "../execution/runtime.js";

/** Passed to {@link EnterFn} when a run starts, before the wrapped operation body begins. */
export interface EnterContext<A = []> {
  readonly signal: AbortSignal;
  readonly args: A;
}

export type EnterFn<A> = (ctx: EnterContext<A>) => unknown;
export type ExitFn<T = unknown, E = unknown, A = []> = (ctx: ExitContext<T, E, A>) => unknown;

/** Widened hook for {@link builders.defer} where enclosing `Op` `T`/`E` are not inferred. */
export type AnyExitFn = ExitFn<unknown, unknown, readonly unknown[]>;

export type ReleaseFn<T> = (value: T) => unknown;

/** Lifecycle channels exposed by {@link Op}. */
export type OpLifecycleHook = "enter" | "exit";
