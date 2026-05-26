/**
 * Low-level helpers and type guards shared across `@prodkit/*` packages.
 *
 * This entry is intended for library code building on `@prodkit/op`, not for most
 * application imports. It may evolve more freely than the primary `Op` namespace;
 * treat breaking changes here as semver-breaking for `@prodkit/op` until documented
 * otherwise.
 */
export {
  EMPTY_TUPLE,
  OP_BOUND_BRAND,
  OP_BRAND,
  coerceToNullaryOp,
  hasBrand,
  isAwaited,
  isIterableOp,
  isOp,
  isPromiseLike,
  NEVER,
  sleepWithSignal,
  type AbortSignalLike,
  unsafeCoerce,
} from "./shared.js";
export { SuspendInstruction } from "./core/instructions.js";
export { createRunContext, drive } from "./core/runtime.js";
export { CUSTOM_INSTRUCTION_META } from "./core/types.js";
export type {
  CustomInstruction,
  NormalizeMeta,
  RunContext,
  Simplify,
  StripEmpty,
} from "./core/types.js";
