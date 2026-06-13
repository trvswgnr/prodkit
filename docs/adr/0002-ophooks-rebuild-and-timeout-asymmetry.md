---
status: superseded
title: OpHooks push-through rebuild and timeout-specific rebuild hooks
packages:
  - "@prodkit/op"
---

# OpHooks push-through rebuild and timeout-specific rebuild hooks

**Superseded by [ADR 0007](0007-op-execution-plan-ast.md)** (plan AST). For
current policy attachment, see [ADR 0009](0009-policy-with-attachment.md).

This record documents the pre-plan hook model removed when `packages/op/src/plan/` became the
internal execution representation.

## Historical API names

| Pre-ADR 0009 | Current |
| --- | --- | --- |
| `.withRetry(...)` | `.with(Policy.retry(...))` |
| `.withTimeout(...)` | `.with(Policy.timeout(...))` |
| `.withSignal(...)` | `.with(Policy.cancel(...))` |
| `.withRelease(...)` | `.with(Policy.release(...))` |

## Historical decision

Policies could wrap the outer op shell or push through to an `inner` op and `rebuild` the fluent
transform around the result. Error-channel transforms also used `rebuildForTimeout` so
`TimeoutError` did not reach callbacks typed on `E` alone. `flatMap` intentionally had no
push-through because it ran two sequential drives.

Combinators chose per-hook support (`inner`/`rebuild`, optional `rebuildForTimeout`) instead of a
shared structural model. That spread `unsafeCoerce` through the fluent layer and motivated the
plan AST cutover in ADR 0007.

For the full pre-cutover hook matrix and spike notes, see git history on this file before the ADR
cleanup pass.
