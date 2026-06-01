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

type SuspendFn = (ctx: RunContext<readonly unknown[]>) => PromiseLike<unknown>;
export class SuspendInstruction extends Tagged("SuspendInstruction") {
  readonly suspend: SuspendFn;
  /** When true, interrupt-on-abort waits for this suspend to settle so fan-out/provision teardown can finish. */
  readonly drainOnAbort: boolean;

  constructor(suspend: SuspendFn, drainOnAbort = false) {
    super();
    this.suspend = suspend;
    this.drainOnAbort = drainOnAbort;
  }

  // SAFETY: TS doesn't know the type of the yielded value, so it's always `unknown`
  // we use a single `any` here to avoid casting at every call site
  // oxlint-disable-next-line typescript/no-explicit-any
  *[Symbol.iterator](): Generator<Instruction<never, any>, any, unknown> {
    return yield this;
  }
}

type FinalizeFn = (ctx: ExitContext<unknown, unknown, readonly unknown[]>) => PromiseLike<void>;
export class RegisterExitFinalizerInstruction extends Tagged("RegisterExitFinalizerInstruction") {
  readonly finalize: FinalizeFn;
  readonly args: readonly unknown[] | undefined;

  constructor(finalize: FinalizeFn, args?: readonly unknown[]) {
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
