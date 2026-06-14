---
status: accepted
title: Combinator concurrent composition as plan nodes
packages:
  - "@prodkit/op"
---

# Combinator concurrent composition as plan nodes

Public combinators (`Op.all`, `Op.race`, `Op.any`, `Op.allSettled`, `Op.settle`) are plan-backed
ops that delegate to combinator plan nodes in `packages/op/src/plan/combinators.ts`. Shared
fan-out lives in `packages/op/src/execution/fan-out.ts`. `.with(Policy.*)` pushes through to child
plans structurally via `PlanRewriter` hooks ([ADR 0007](0007-op-execution-plan-ast.md)).

## Decision

**Each public combinator is a plan node.** Multi-child combinators (`allPlan`, `racePlan`,
`anyPlan`, `allSettledPlan`) use `createPlan` with `rewrite` that maps each child plan. Unary
`settlePlan` uses `createUnaryPlan` like `mapPlan` and policy wrappers: one child via
`source.execute`, rebuilt with `(inner) => settlePlan(inner)`.

| Plan node | Public op | Child cancel settlement | Loser wait |
| --- | --- | --- | --- |
| `allPlan` | `Op.all` | `interruptOnAbort` | yes (first error or all ok) |
| `racePlan` | `Op.race` | `interruptOnAbort` | yes ([ADR 0004](0004-combinators-wait-for-loser-finalization.md)) |
| `anyPlan` | `Op.any` | `interruptOnAbort` | yes (ADR 0004) |
| `allSettledPlan` | `Op.allSettled` | `passThrough` | all branches finish |
| `settlePlan` | `Op.settle` | `passThrough` | single child finishes |

Public factories bind `OP_PLAN_BIND` and delegate to these nodes. Imperative fan-out was removed
from the public combinator module; concurrency runs through `execution/fan-out.ts`.

**Shared fan-out owns child wiring and settlement.** Per-child `AbortController` wiring, outer-signal
cascade, `detach()` for parent abort listeners, unbounded fan-out, bounded worker pool, and child
execution through `Plan.execute` with `AbortSettlement` (not ad hoc `drive*` at the combinator
layer). Combinator plan nodes call fan-out with the settlement row from the table above. The outer
`SuspendInstruction` for combinator plans wraps returned fan-out work with `withAbortDrain(...)` when
interrupt settlement applies so timeout/cancel on a wrapped combinator still drains in-flight children
([ADR 0004](0004-combinators-wait-for-loser-finalization.md)).

**Rewrite contract.** Built-in policies supply `PlanRewriter.apply` only. Combinator and transform
plan nodes rebuild after `child.rewrite(rewriter)` (or `rewriteUnaryPlan` for unary wrappers).
Policy push-through is structural: `.with(Policy.timeout(ms))` on `Op.all([child])` becomes
`timeoutPlan(allPlan([childPlan]))` after rewrite.

**Public API unchanged.** Tuple inference, meta merge, `ErrorGroup` on `Op.any`, input-order
results on `Op.all` / `Op.allSettled`, and empty-input errors are unchanged; only the internal
representation lives under `plan/`.

**`DI.provide` is plan-backed** with the same local `source.rewrite(rewriter)` rebuild pattern.

## Why not keep imperative fan-out?

**Policy attach stayed outer-only.** When children never appeared in the AST, combinator-level
timeout/retry/cancel could not participate in `PlanRewriter`, blocking the ADR 0007 goal.

**Two execution ports duplicated settlement.** Combinators and plans previously exposed parallel
interrupt-on-abort entry points. Nested work now routes through `executePlan` with `AbortSettlement`.

## Considered options

**Leave combinators imperative; extend policy stack (ADR 0007 spike B).** Rejected: concentrates
coerces at attach sites and keeps two concurrency implementations.

**Single mega `concurrentPlan` node with mode enum.** Rejected: erases distinct rewrite hooks and
makes typed error channels (`ErrorGroup` vs first error) harder to preserve at the plan layer.

**Rewrite via generic tree walk only (no combinator hooks).** Deferred: viable later, but combinator
nodes still need explicit rewrite methods until ceremony is reduced.

## Consequences

- New combinator plan nodes follow CONTRIBUTING "Adding a fluent plan transform" touch points until
  generic rewrite reduces ceremony.
- `packages/op/src/core/combinators.ts` holds public op factories and type helpers; fan-out and plan
  shapes live under `plan/`.
- Tests from ADR 0004 and op-invariants.md Invariant 3 are the behavioral contract.
- Driver-level abort settlement uses `packages/op/src/execution/abort-settlement.ts`; contributor
  call sites select named operations from `packages/op/src/execution/settlement.ts`.
