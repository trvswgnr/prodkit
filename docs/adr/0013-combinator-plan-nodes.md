---
status: accepted
title: Combinator concurrent composition as plan nodes
packages:
  - "@prodkit/op"
---

# Combinator concurrent composition as plan nodes

Public combinators (`Op.all`, `Op.race`, `Op.any`, `Op.allSettled`) are plan-backed ops that
delegate to combinator plan nodes in `packages/op/src/core/plan/combinators.ts`. Shared fan-out
lives in `packages/op/src/core/plan/fan-out.ts`. `.with(Policy.*)` pushes through to child plans
structurally via `PlanRewriter` hooks ([ADR 0007](0007-timeout-widening-at-composition-boundary.md)).

Issue [#167](https://github.com/trvswgnr/prodkit/issues/167) recorded the design gate; implementation
slices [#170](https://github.com/trvswgnr/prodkit/issues/170) through
[#173](https://github.com/trvswgnr/prodkit/issues/173) and [#172](https://github.com/trvswgnr/prodkit/issues/172)
(`providePlan`) are complete.

## Decision

**Each public combinator becomes a plan node** with the same `createPlan` + optional `rewrite`
pattern as fluent transforms (`mapPlan`, `onEnterPlan`, policy plans):

| Plan node | Public op | Child drive settlement | Loser wait |
| --- | --- | --- | --- |
| `allPlan` | `Op.all` | `interruptOnAbort` | yes (first error or all ok) |
| `racePlan` | `Op.race` | `interruptOnAbort` | yes ([ADR 0004](0004-combinators-wait-for-loser-finalization.md)) |
| `anyPlan` | `Op.any` | `interruptOnAbort` | yes (ADR 0004) |
| `allSettledPlan` | `Op.allSettled` | `passThrough` | all branches finish |

Public `Op.all` / `Op.race` / `Op.any` / `Op.allSettled` are plan-backed ops (`OP_PLAN_BIND`)
that delegate to these nodes. Imperative fan-out was removed from `combinators.ts`; concurrency
runs through `core/plan/fan-out.ts`.

**Shared fan-out lives in `packages/op/src/core/plan/fan-out.ts`.** It owns:

- per-child `AbortController` wiring and outer-signal cascade
- `detach()` for parent abort listeners
- unbounded fan-out and bounded worker pool (today's `driveFirstSettlerFanOut` / `driveBoundedPool`)
- child execution through **`Plan.execute`** with settlement from `CancelSettlement` (not ad hoc
  `drive*` at the combinator layer)

Combinator plan nodes call fan-out with the settlement row from the table above. The outer
`SuspendInstruction` for combinator plans sets `SuspendResume.drainAfterAbort` when interrupt
settlement applies so timeout/cancel on a wrapped combinator still drains in-flight children ([ADR
0004](0004-combinators-wait-for-loser-finalization.md) consequences).

**Rewrite contract.** Add optional `PlanRewriter` methods mirroring combinator names
(`all`, `race`, `any`, `allSettled`). Each method:

1. rewrites every child plan with `source.rewrite(rewriter)`
2. rebuilds the combinator node with the rewritten children and the same options (for example
   `concurrency`)

Policy push-through is structural: `.with(Policy.timeout(ms))` on `Op.all([child])` becomes
`timeoutPlan(allPlan([childPlan]))` after rewrite, not a timeout around an opaque imperative shell.

**Public API unchanged.** Tuple inference, meta merge, `ErrorGroup` on `Op.any`, input-order
results on `Op.all` / `Op.allSettled`, and empty-input errors stay as today. Only the internal
representation moves under `core/plan/`.

## Why not keep imperative fan-out?

**Policy attach stays outer-only.** Timeout/retry/cancel on a combinator child today does not
participate in `PlanRewriter` because children never appear in the AST. That blocks the ADR 0007
goal without a parallel policy stack.

**Duplicate execution ports (resolved).** Before [#173](https://github.com/trvswgnr/prodkit/issues/173),
combinators and plans used parallel `driveInterruptOnAbort` / `executePlanInterruptOnAbort` entry
points. Nested work now routes through `executePlan` with `PlanExecutionMode` (`CancelSettlement`).

## Considered options

**Leave combinators imperative; extend policy stack (ADR 0007 spike B).** Rejected: concentrates
coerces at attach sites and keeps two concurrency implementations.

**Single mega `concurrentPlan` node with mode enum.** Rejected: erases distinct rewrite hooks and
makes typed error channels (`ErrorGroup` vs first error) harder to preserve at the plan layer.

**Rewrite via generic tree walk only (no combinator hooks).** Deferred to [#168](https://github.com/trvswgnr/prodkit/issues/168): viable later, but combinator nodes still need explicit rewrite methods until ceremony is reduced.

## Consequences

- New combinator plan nodes follow CONTRIBUTING "Adding a fluent plan transform" touch points until
  [#168](https://github.com/trvswgnr/prodkit/issues/168) lands.
- `packages/op/src/combinators.ts` shrinks to public op factories and type helpers; fan-out moves to
  `core/plan/fan-out.ts`, plan shapes to `core/plan/combinators.ts`.
- Tests from ADR 0004 and DESIGN.md Invariant 3 remain the behavioral contract for migration slices.
- Cancellation settlement uses `core/cancel-session.ts` ([#166](https://github.com/trvswgnr/prodkit/issues/166)).

## Implementation status

Slices from this ADR landed on main:

**[#170](https://github.com/trvswgnr/prodkit/issues/170) (`allPlan` tracer bullet)** complete.

**[#171](https://github.com/trvswgnr/prodkit/issues/171) (remaining combinators)** complete.

**[#173](https://github.com/trvswgnr/prodkit/issues/173) (single plan port)** complete: nested
combinator, DI provision, and timeout inner runs share `executePlan` with `PlanExecutionMode`.

**[#172](https://github.com/trvswgnr/prodkit/issues/172) (`providePlan`)** complete:
`DI.provide` is plan-backed; policy push-through re-wraps via local `source.rewrite` (no
`PlanRewriter.provide` hook in core).
