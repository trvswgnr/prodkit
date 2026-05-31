/**
 * Low-level exports for op extension authors and monorepo maintainers.
 * Not intended for typical application code that imports `@prodkit/op`.
 */
export { withBlocking, type BlockingOp } from "../blocking.js";
export {
  CUSTOM_INSTRUCTION_META,
  type AnyNullaryOp,
  type Blocking,
  type CustomInstruction,
  type EmptyMeta,
  type EnterFn,
  type ExitFn,
  type InferInstructionErr,
  type InferInstructionMeta,
  type InferOpMeta,
  type Instruction,
  type IsRunnable,
  type MergeMeta,
  type Meta,
  type RunContext,
  type SetBlockingMeta,
} from "../core/types.js";
export {
  type AbortSignalLike,
  NEVER,
  hasBrand,
  hasOwn,
  sleepWithSignal,
  unsafeCoerce,
} from "../shared.js";
