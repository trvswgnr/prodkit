---
status: accepted
title: Combinator concurrent composition as plan nodes
packages:
  - "@prodkit/op"
---

# Combinator concurrent composition as plan nodes

Public combinators (`Op.all`, `Op.race`, `Op.any`, `Op.allSettled`) still orchestrate concurrency in
`packages/op/src/combinators.ts` via imperative `fanOut` and direct `drive*` calls. That bypasses
the plan AST from [ADR 0007](0007-timeout-widening-at-composition-boundary.md), so `.with(Policy.*)`
only wraps the outer combinator shell instead of pushing through to child plans structurally.

Issue [#167](https://github.com/trvswgnr/prodkit/issues/167) records the design gate; implementation
slices are [#170](https://github.com/trvswgnr/prodkit/issues/170) through
[#173](https://github.com/trvswgnr/prodkit/issues/173).

## Decision

**Each public combinator becomes a plan node** with the same `createPlan` + optional `rewrite`
pattern as fluent transforms (`mapPlan`, `onEnterPlan`, policy plans):

| Plan node | Public op | Child drive settlement | Loser wait |
| --- | --- | --- | --- |
| `allPlan` | `Op.all` | `interruptOnAbort` | yes (first error or all ok) |
| `racePlan` | `Op.race` | `interruptOnAbort` | yes ([ADR 0004](0004-combinators-wait-for-loser-finalization.md)) |
| `anyPlan` | `Op.any` | `interruptOnAbort` | yes (ADR 0004) |
| `allSettledPlan` | `Op.allSettled` | `passThrough` | all branches finish |

Public `Op.all` / `Op.race` / `Op.any` / `Op.allSettled` become plan-backed ops (`OP_PLAN_BIND`)
that delegate to these nodes. Imperative fan-out in `combinators.ts` is removed once the migration
slices land.

**Shared fan-out lives in `packages/op/src/core/plan/fan-out.ts`.** It owns:

- per-child `AbortController` wiring and outer-signal cascade
- `detach()` for parent abort listeners
- unbounded fan-out and bounded worker pool (today's `driveFirstSettlerFanOut` / `driveBoundedPool`)
- child execution through **`Plan.execute`** with settlement from `CancelSettlement` (not ad hoc
  `drive*` at the combinator layer)

Combinator plan nodes call fan-out with the settlement row from the table above. The outer
`SuspendInstruction` for combinator plans sets `drainOnAbort: true` when interrupt settlement
applies so timeout/cancel on a wrapped combinator still drains in-flight children ([ADR
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

**Duplicate execution ports.** Combinators call `driveInterruptOnAbort` while plans use
`executePlanInterruptOnAbort`; [#173](https://github.com/trvswgnr/prodkit/issues/173) collapses
that, but combinator migration should already route nested work through `Plan.execute` so the
later port is a driver rename, not a behavior rewrite.

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

## Implementation

Slice acceptance criteria (derived from this ADR):

**[#170](https://github.com/trvswgnr/prodkit/issues/170) (`allPlan` tracer bullet)**

- [ ] `Op.all` is plan-backed via `allPlan` and `OP_PLAN_BIND`
- [ ] Existing `Op.all` tests pass unchanged
- [ ] At least one test shows `.with(Policy.timeout(...))` rewrites the inner child plan, not only
  the outer shell
- [ ] Loser finalization and input-order semantics match ADR 0004 / DESIGN.md Invariant 3

**[#171](https://github.com/trvswgnr/prodkit/issues/171) (remaining combinators)**

- [ ] `racePlan`, `anyPlan`, `allSettledPlan` backed with rewrite hooks
- [ ] Full combinator test suite passes unchanged
- [ ] No public combinator uses ad hoc `drive*` fan-out outside the plan layer

**[#173](https://github.com/trvswgnr/prodkit/issues/173) (single plan port)**

- [ ] Nested combinator and DI runs use one internal execution adapter (see ADR scope note above)

**[#172](https://github.com/trvswgnr/prodkit/issues/172) (`providePlan`)**

- [ ] Out of scope for this ADR; follows combinator port and cancel session ([#166](https://github.com/trvswgnr/prodkit/issues/166))
