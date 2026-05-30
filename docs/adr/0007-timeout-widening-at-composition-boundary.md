---
status: accepted
title: Op execution plan AST vs push-through rebuild hooks
packages:
  - "@prodkit/op"
---

# Op execution plan AST vs push-through rebuild hooks

Issue #111 explored whether timeout widening can be simplified without a bigger refactor. Three
prototype approaches were evaluated locally; none were merged into the tree. **This ADR supersedes
the narrower boundary-widening recommendation in the first draft of ADR 0007.**
Policy method names in the spike notes are historical; ADR 0009 replaced public retry, timeout,
signal, and release methods with `.with(Policy.*)`.

## Problem

The fluent layer uses `OpHooks.inner` + `rebuild` (+ `rebuildForTimeout` for error callbacks) so
policy push-through preserves ordering documented in `DESIGN.md`. TypeScript cannot prove inner
op shapes through generic rebuild callbacks, so the fluent layer carries ~29 `unsafeCoerce`
calls. Relocating TimeoutError filtering (boundary spike) does not fix that root cause.

## Spikes tried

### A. Runtime boundary widening (`timeout-boundary.ts`) - rejected

Unified `rebuild` + runtime `TimeoutError.is` guards. Viable, but mostly moves complexity.
Not a fundamental fix.

### B. Policy stack on push target (`policy-stack.ts`) - incremental

Policies append to a shared `PushTargetBox` on the leaf op. Combinator shells are not rebuilt;
`.withTimeout()` mutates the box and returns the same shell identity. Suspend sites call
`drivePushTarget(box.current)`.

**Results:** passes the #103 push-through matrix for `mapErr` / `tapErr` / `recover`. ~8 coerces
in spike vs ~29 in production fluent layer. **Still lazy-wraps the leaf** via production
`withTimeoutOp` inside `applyPolicyStack` - deferred rebuild, not eliminated. Lifted arity and
`flatMap` still need separate designs.

### C. Plan AST (`op-plan.ts`) - structural

`Plan<T, E>` with `execute(context)`. Combinators and policies are plan nodes. Push-through is
tree shape: `timeoutPlan(mapErrPlan(leaf))`. **Zero coerces in spike.** Types flow from plan
generics without hook rebuild typing.

**Results:** same behavioral matrix as B for covered combinators. Does not yet address tuple
arity, `yield* op`, iterable interop, or the existing generator driver.

## Tradeoffs

| Approach | Coerces (spike) | Push-through | Type inference | Cutover size |
| --- | --- | --- | --- | --- |
| Production rebuild hooks | ~29 | yes | poor (hook coerces) | n/a |
| Boundary widening | ~15 | yes | poor | medium |
| Policy stack | ~8 | yes | coerces at attach | medium |
| Plan AST | 0 | structural | good at plan layer | large |

## Recommendation

For a **bigger refactor worth doing**, pursue **Plan AST (Spike C)** as the internal execution
model:

1. Introduce `Plan<T, E>` (or `OpPlan`) as the canonical representation of composed work.
2. Keep public `Op` as a facade: callable + fluent methods compile to / hold a plan.
3. Policies become plan nodes; delete `OpHooks.rebuild` and `rebuildForTimeout`.
4. Generator-based ops (`Op.try`, custom instructions) compile to leaf plans or stay as plan
   leaves executed via `drive`.
5. Lifted arity becomes plan instantiation with args, not `liftOp` dual mappers.

**Policy stack (Spike B)** is a reasonable incremental milestone if you want value before the full
AST cutover, but it does not remove the fundamental typing pressure - it concentrates coerces at
policy attach and leaf wrap sites.

The cutover landed as the internal `packages/op/src/core/plan/` model. `OpHooks` rebuild callbacks
and `fluent-timeout.ts` were removed; public `Op<T, E, A, M>` stayed the facade.

## Consequences

- ADR 0002 is superseded by this plan model.
- Epic #86 cast work should target plan introduction, not incremental adapter tweaks.
- Plan AST cutover work is tracked as sub-issues of #111 (#116-#123).
