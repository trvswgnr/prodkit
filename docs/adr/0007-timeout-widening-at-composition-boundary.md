---
status: accepted
title: Op execution plan AST vs push-through rebuild hooks
packages:
  - "@prodkit/op"
---

# Op execution plan AST vs push-through rebuild hooks

For current `.with(Policy.*)` behavior, see [ADR 0009](0009-policy-with-attachment.md). This ADR
supersedes [ADR 0002](0002-ophooks-rebuild-and-timeout-asymmetry.md).

## Decision

**Internal execution is a `Plan<T, E>` AST** under `packages/op/src/core/plan/`. Composed work,
fluent transforms, policies, and combinators are plan nodes. Public `Op<T, E, A, M>` remains the
callable facade; tuple args bind at the shell, then `Plan.execute` drives the tree.

**Policy push-through is structural rewrite**, not per-combinator `OpHooks.rebuild` /
`rebuildForTimeout`. `.with(Policy.timeout(ms))` on `op.map(f)` becomes a timeout plan node around
the mapped inner plan, preserving ordering documented in `DESIGN.md`. The hook rebuild layer and
`fluent-timeout.ts` adapters were removed at cutover.

**Timeout widening stays at the plan boundary.** Error-channel transforms filter `TimeoutError` at
plan construction time so user callbacks typed on `E` do not observe timeout failures as domain
errors.

## Problem

The hook rebuild model (`inner` + `rebuild`, optional `rebuildForTimeout`) could preserve policy
ordering but TypeScript could not prove inner shapes through generic rebuild callbacks. The fluent
layer carried many `unsafeCoerce` calls. Relocating `TimeoutError` filters alone did not fix that
pressure.

## Considered options

Local spikes compared four approaches before cutover:

| Approach | Push-through | Typing pressure | Cutover size |
| --- | --- | --- | --- |
| Production rebuild hooks | yes | high (hook coerces) | n/a |
| Runtime boundary widening | yes | medium | medium |
| Policy stack on leaf box | yes | coerces at attach | medium |
| Plan AST | structural | low at plan layer | large |

**Plan AST (chosen).** Policies and combinators are nodes; rewrite walks the tree. Spike C matched
the behavioral matrix without hook coerces. Policy stack (spike B) was a viable incremental step but
did not remove the fundamental typing problem.

**Boundary-only widening (spike A).** Rejected as a standalone fix: mostly relocated complexity.

## Consequences

- New fluent transforms and combinators should extend the plan model and `PlanRewriter` hooks
  ([ADR 0013](0013-combinator-plan-nodes.md)), not reintroduce rebuild callbacks.
- ADR 0002 is superseded; read it only for pre-plan history.
- Behavioral contracts (policy ordering, timeout widening, combinator settlement) live in
  `DESIGN.md`; this ADR records why the AST replaced hooks.
