---
status: accepted
title: Op.any and Op.race wait for loser finalization before run settles
packages:
  - "@prodkit/op"
---

# Op.any and Op.race wait for loser finalization before run settles

`Op.any` and `Op.race` pick a winner as soon as one child settles favorably, abort the remaining
siblings, and still keep `.run()` pending until every aborted branch finishes teardown.

## Decision

**Winner selection is eager; return is not.** In `packages/op/src/combinators.ts`, `driveAny` and
`driveRace` abort losing controllers when a winner is chosen, then `await Promise.all` on every
child drive promise before returning. The caller gets the winner's value or error only after loser
runs complete their exit finalizers and generator finalization.

**Winner outcome keeps precedence.** A loser failing while reacting to abort does not override an
already chosen success (`Op.any`) or the first settled result (`Op.race`). Waiting is for cleanup
completion, not for re-voting on the outcome.

**Same abort umbrella for siblings.** `fanOut` gives each child its own controller linked to the
outer run signal so cancellation propagates without leaking listeners when branches settle.

## Why not return immediately?

**Leaked work and resources.** Returning as soon as the winner settles would let aborted branches
keep running unsupervised past the combinator boundary. Callers would observe success while sibling
HTTP requests, file handles, or defer hooks still execute.

**Nondeterministic cleanup relative to the result.** Tests, logs, and downstream code assume
`.run()` means the composed operation is fully settled, not merely that one branch won the race.
Early return would make finalizer ordering depend on scheduler timing outside the combinator.

**Consistency with the single-op contract.** A lone `Op` does not resolve until `drive` finishes
finalizers for that invocation. Combinators compose multiple drives; dropping the loser wait would
make `Op.race([a, b])` weaker than `Promise.race` wrapped in defer hooks on each branch.

## Considered options

**Return the winner immediately and detach losers.** Rejected: violates the settlement guarantee
above and reintroduces the "background branch still running" failure mode `Op` targets.

**Fire-and-forget abort without awaiting loser drives.** Rejected: abort signals cooperative
cancellation but does not wait for teardown; finalizers and suspending cleanup still need the
loser drive to finish.

**Opt-in fast path (for example `.raceFast`).** Deferred: adds API surface for a trade-off callers
 rarely need in alpha; revisit only with explicit demand and documented leak semantics.

## Consequences

- Performance-sensitive call sites cannot shorten `Op.any` / `Op.race` by configuration today; the
  wait is part of the combinator contract (Invariant 3 in `DESIGN.md`).
- New concurrent combinators that abort siblings should follow `fanOut` plus full sibling
  settlement unless there is a documented, narrower leak contract.
- `DESIGN.md` states the wait-for-loser-finalization invariant and tests; this ADR records the
  latency/correctness trade-off behind it.
