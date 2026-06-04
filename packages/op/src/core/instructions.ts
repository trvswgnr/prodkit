// oxlint-disable typescript/no-explicit-any
import { Tagged } from "../tagged.js";
import { Err } from "../result.js";
import type { ExitContext, RunContext } from "./runtime.js";
import type { EmptyMeta, MergeUnionMeta } from "./meta.js";

export const CUSTOM_INSTRUCTION_META = Symbol("prodkit.op.custom-instruction-meta");

/**
 * Extension protocol for custom generator yield instructions.
 *
 * Implementations are detected at runtime via {@link CUSTOM_INSTRUCTION_META}
 * and executed through {@link CustomInstruction.resolve}.
 *
 * Typed failures should be surfaced by yielding {@link Err} values from
 * `[Symbol.iterator]` or from the enclosing generator; throws from `resolve`
 * surface as {@link UnhandledException}.
 */
export interface CustomInstruction<T, M = EmptyMeta> {
  readonly [CUSTOM_INSTRUCTION_META]: M;
  resolve(context: RunContext<readonly unknown[]>): T | PromiseLike<T>;
  [Symbol.iterator](): Generator<this, T, unknown>;
}

type ExtractInstructionMeta<Y> = Y extends CustomInstruction<any, infer M> ? M : never;

type NonEmptyInstructionMeta<Y> = Exclude<ExtractInstructionMeta<Y>, EmptyMeta>;

export type InferInstructionMeta<Y> = [NonEmptyInstructionMeta<Y>] extends [never]
  ? EmptyMeta
  : MergeUnionMeta<NonEmptyInstructionMeta<Y>>;

type DropUnknown<E> = unknown extends E ? never : E;
type ExtractResultErr<Y> = Y extends Err<unknown, infer E> ? DropUnknown<E> : never;

export type InferInstructionErr<Y> = ExtractResultErr<Y>;

const ABORT_DRAINED_WORK = Symbol("prodkit.op.abort-drained-work");

type AbortDrainedWork<T> = {
  readonly [ABORT_DRAINED_WORK]: true;
  readonly promise: PromiseLike<T>;
};

export type SuspendWork<T> = PromiseLike<T> | AbortDrainedWork<T>;

export function withAbortDrain<T>(promise: PromiseLike<T>): AbortDrainedWork<T> {
  return { [ABORT_DRAINED_WORK]: true, promise };
}

export function isAbortDrainedWork<T>(work: SuspendWork<T>): work is AbortDrainedWork<T> {
  return typeof work === "object" && work !== null && ABORT_DRAINED_WORK in work;
}

export type SuspendFn = (ctx: RunContext<readonly unknown[]>) => SuspendWork<unknown>;

export class SuspendInstruction extends Tagged("SuspendInstruction") {
  readonly suspend: SuspendFn;

  constructor(suspend: SuspendFn) {
    super();
    this.suspend = suspend;
  }

  // SAFETY: SuspendInstruction yield type is call-site specific; one any avoids per-site coercion.
  // oxlint-disable-next-line typescript/no-explicit-any
  *[Symbol.iterator](): Generator<Instruction<never, any>, any, unknown> {
    return yield this;
  }
}

type FinalizeFn = (ctx: ExitContext<unknown, unknown, readonly unknown[]>) => PromiseLike<void>;

export class RegisterExitFinalizerInstruction extends Tagged("RegisterExitFinalizerInstruction") {
  readonly finalize: FinalizeFn;
  readonly args: readonly unknown[] | undefined;

  constructor(finalize: FinalizeFn, args: readonly unknown[] | undefined) {
    super();
    this.finalize = finalize;
    this.args = args;
  }
}

export type Instruction<E, M = EmptyMeta> =
  | Err<unknown, E>
  | SuspendInstruction
  | RegisterExitFinalizerInstruction
  | CustomInstruction<unknown, M>;

export function isErrInstruction<E>(value: unknown): value is Err<unknown, E> {
  return (
    typeof value === "object" &&
    value !== null &&
    "isErr" in value &&
    typeof value.isErr === "function" &&
    value.isErr()
  );
}
