/**
 * Low-level exports for op extension authors and monorepo maintainers.
 * Not intended for typical application code that imports `@prodkit/op`.
 */
export { withBlocking, type BlockingOp } from "../blocking.js";
export { type EnterFn, type ExitFn } from "../core/plan/context.js";
export { type AnyNullaryOp, type InferOpMeta } from "../core/plan/surface.js";
export {
  CUSTOM_INSTRUCTION_META,
  type CustomInstruction,
  type InferInstructionErr,
  type InferInstructionMeta,
  type Instruction,
} from "../core/instructions.js";
export {
  type Blocking,
  type EmptyMeta,
  type IsRunnable,
  type MergeMeta,
  type SetBlockingMeta,
} from "../core/meta.js";
export { type RunContext } from "../core/runtime.js";
export { type AbortSignalLike, NEVER, hasBrand, sleepWithSignal, unsafeCoerce } from "../shared.js";
