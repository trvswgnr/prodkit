/**
 * Low-level exports for op extension authors and monorepo maintainers.
 * Not intended for typical application code that imports `@prodkit/op`.
 */
export { type AnyNullaryOp, type InferOpMeta } from "../core/surface.js";
export {
  CUSTOM_INSTRUCTION_META,
  type CustomInstruction,
  type InferInstructionErr,
  type InferInstructionMeta,
  type Instruction,
} from "../execution/instructions.js";
export {
  type Blocking,
  type BlockingOp,
  type EmptyMeta,
  type IsRunnable,
  type MergeMeta,
  type SetBlockingMeta,
  withBlocking,
} from "../core/metadata.js";
export { type RunContext } from "../execution/runtime.js";
