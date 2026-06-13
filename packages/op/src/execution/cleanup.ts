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
 * 2. **Registered exit finalizers** (`runFinalizersSafely`): effectful cleanup via
 *    `RegisterExitFinalizerInstruction` (`Op.defer`, `.on("exit")`, and release hooks registered
 *    after success). Unwind is LIFO; every handler runs; faults take precedence at settlement
 *    (see op-invariants.md Invariants 1 and 2).
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

/**
 * Run every finalizer LIFO and preserve each exact thrown value in execution order.
 *
 * The array shape distinguishes no fault from a finalizer that throws `undefined`.
 */
export async function runFinalizersSafely(
  finalizers: readonly ExitFinalizer[],
  ctx: ExitFinalizerContext,
): Promise<readonly unknown[]> {
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
  return faults;
}
