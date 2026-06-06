import type { Result } from "../result.js";

/**
 * Cleanup registry for ADR-0003's three teardown channels.
 *
 * These helpers are shared infrastructure; they do not merge the channels.
 *
 * 1. **Generator finalization** (`closeGenerator`): best-effort `iterator.return()` so native
 *    generator `finally` runs. Swallows `return()` faults so the body settlement already chosen
 *    by `drive` is preserved.
 *
 * 2. **Registered exit finalizers** (`runFinalizersSafely`, `chainCleanupFaults`): effectful
 *    cleanup via `RegisterExitFinalizerInstruction` (`Op.defer`, `.on("exit")`, and release hooks
 *    registered after success). Unwind is LIFO; every handler runs; faults take precedence at
 *    settlement (see op-invariants.md Invariants 1 and 2).
 *
 * 3. **Success-gated release** (`releasePlan` in `packages/op/src/policy/plan.ts`): drives the
 *    inner plan first, schedules a single exit finalizer only on success. Not implemented here;
 *    documented so callers do not conflate it with generator finalization or unconditional defer.
 */

/** Context passed to each registered exit finalizer at unwind (see `ExitContext` in `runtime.ts`). */
export interface ExitFinalizerContext {
  readonly signal: AbortSignal;
  readonly args: readonly unknown[];
  readonly result: Result<unknown, unknown>;
}

export type ExitFinalizer = (ctx: ExitFinalizerContext) => PromiseLike<void>;

/** Best-effort generator `return()`; swallows faults so body settlement is preserved. */
export function closeGenerator(iterator: Iterator<unknown, unknown, unknown>) {
  try {
    // we intentionally ignore the return payload bc only generator finalization matters
    iterator.return?.(undefined);
  } catch {
    // ignore cleanup faults so the original result/error is preserved
  }
}

/** Fold multiple teardown faults into a nested `Error.cause` chain (outer = first failure in LIFO unwind). */
export function chainCleanupFaults(faults: readonly unknown[]): unknown {
  if (faults.length === 0) return undefined;
  if (faults.length === 1) return faults[0];
  let chain = faults[faults.length - 1];
  for (let i = faults.length - 2; i >= 0; i--) {
    const f = faults[i];
    const msg = f instanceof Error ? f.message : String(f);
    const name = f instanceof Error ? f.name : "Error";
    const layer = new Error(msg, { cause: chain });
    layer.name = name;
    chain = layer;
  }
  return chain;
}

/** Run every finalizer LIFO; collect faults from each (later-registered runs first; all still run even if one throws). */
export async function runFinalizersSafely(
  finalizers: readonly ExitFinalizer[],
  ctx: ExitFinalizerContext,
): Promise<unknown | void> {
  const faults: unknown[] = [];
  for (let index = finalizers.length - 1; index >= 0; index -= 1) {
    const finalize = finalizers[index];
    if (finalize !== undefined) {
      try {
        await finalize(ctx);
      } catch (e) {
        faults.push(e);
      }
    }
  }
  if (faults.length === 0) {
    return undefined;
  }
  if (faults.length === 1) {
    return faults[0];
  }
  return chainCleanupFaults(faults);
}
