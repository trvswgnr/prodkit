---
status: accepted
title: OpHooks push-through rebuild and timeout-specific rebuild hooks
packages:
  - "@prodkit/op"
---

# OpHooks push-through rebuild and timeout-specific rebuild hooks

Policy methods (`.withRetry`, `.withTimeout`, `.withSignal`) can apply in two ways: wrap the
current op shell, or push through to an inner op and rebuild the shell around the result.
`OpHooks` (`packages/op/src/core/types.ts`) carries `inner`, `rebuild`, and optionally
`rebuildForTimeout` so transforms preserve semantics when policies attach to the wrapped op
rather than only the outer generator.

Not every core combinator supplies these hooks, and not every hook supplier defines
`rebuildForTimeout`. That asymmetry is intentional.

## Decision

**Push-through (`inner` + `rebuild`).** When present, `makeCoreOp` applies policies to
`inner` first, then calls `rebuild(newInner)` to reconstruct the transform around the
policy-wrapped inner op. Combinators that are a single wrapper around one child drive
(`mapCoreOp`, `tapCoreOp`, `tapErrCoreOp`, `mapErrCoreOp`, `recoverCoreOp`, lifecycle wrappers)
use this pattern so `.withRetry()` on `op.map(f)` retries the mapped inner work, not an
accidentally outer-only shell.

**No push-through (`flatMapCoreOp`).** `flatMapCoreOp` runs two sequential drives (source op,
then `bind(value)`). There is no single inner op whose policy should silently precede the bind
step. Policies on a flatMap therefore wrap the whole composed op via default `withRetryOp` /
`withTimeoutOp` on `self`. Adding `inner`/`rebuild` would pick an arbitrary split (retry only
the first drive?) and hide ordering surprises.

**Timeout-specific rebuild (`rebuildForTimeout`).** `.withTimeout()` widens the error channel to
`E | TimeoutError`. Combinators whose user callbacks observe or transform errors must not pass
`TimeoutError` into callbacks typed for `E`. Those ops define `rebuildForTimeout`, which wraps
the timeout-widened inner op with adapters in `packages/op/src/core/fluent-timeout.ts`
(`adaptErrorCallbackForTimeout`, predicate guards, or no-op observers for timeout).

**Default fallback.** When `rebuildForTimeout` is omitted, `makeCoreOp` uses `rebuild` for
timeout push-through. That is correct when the combinator never invokes error callbacks
(`mapCoreOp`, `tapCoreOp`) because timeout failures short-circuit before success-path logic runs.

## Which ops get which hooks

| Combinator | `inner` / `rebuild` | `rebuildForTimeout` | Reason |
| --- | --- | --- | --- |
| `mapCoreOp`, `tapCoreOp` | yes | no (uses `rebuild`) | Success-path only; errors propagate unchanged |
| `flatMapCoreOp` | no | no | Two-phase drive; policy wraps whole op |
| `tapErrCoreOp`, `mapErrCoreOp`, `recoverCoreOp` | yes | yes | Error callbacks must filter `TimeoutError` |
| `onExitCoreOp` | yes | yes | Exit handler sees `Result`; timeout must not reach user `finalize` typed on `E` |
| `withCleanupCoreOp`, `onEnterCoreOp` | yes | no | No error-channel callbacks widened by timeout |

On the lifted path, `liftOp` mirrors the same split: transforms that touch errors pass a
separate `mapCoreForTimeout` callback; `map` / `flatMap` / `tap` reuse the same core mapper for
both branches because their logic is success-path-only.

## Considered options

**Uniform `rebuildForTimeout` on every combinator.** Rejected: it adds hook surface and casts
with no behavior change for success-path operators, and cannot resolve flatMap's two-drive shape
without picking misleading semantics.

**Always wrap policies on the outer shell (no push-through).** Rejected: `.withRetry()` on
`op.map(f)` would retry only the outer suspend boundary, not the inner op users think they
configured, breaking policy ordering documented in `DESIGN.md`.

## Consequences

- Adding a new error-aware combinator requires deciding whether timeout widens callback inputs;
  if yes, add both `rebuild` and `rebuildForTimeout` (or shared helpers in `fluent-timeout.ts`).
- Adding a multi-drive combinator should follow `flatMapCoreOp` unless there is a clear single
  inner op to push policies through.
- Timeout-related casts called out in epic #86 concentrate in error-channel rebuild paths; they
  encode the `E` vs `E | TimeoutError` split rather than redundant architecture.
