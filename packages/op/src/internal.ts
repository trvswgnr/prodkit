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
