---
status: accepted
title: UnhandledException is the non-recoverable runtime error channel
packages:
  - "@prodkit/op"
---

# UnhandledException is the non-recoverable runtime error channel

Public `.run()` resolves to `Result<T, E | UnhandledException>`. Typed `E` carries domain failures
the author declared; `UnhandledException` carries unexpected faults, runtime normalization, and
cleanup failures that must not be silently coerced into domain errors.

## Decision

**Two error layers.** User-modeled errors flow through `yield* Result.err(...)`, `Op.fail`, and
mapped channels (`mapErr`, `recover` predicates on `E`). The driver and builders widen internally
with `E | UnhandledException` where throws, invalid yields, or infrastructure faults can appear.
The public result type exposes that widening at the boundary so callers never assume `E` is exhaustive.

**Normalize at boundaries, do not throw from public entrypoints.** `Op.try` without `onError`,
invalid yielded instructions, and similar faults become `Err(UnhandledException)` at run time rather
than rejecting the `.run()` promise. Maintainers extend behavior by returning `Result`, not by
throwing through the exported API surface.

**`UnhandledException` bypasses user error transforms.** `recover`, `mapErr`, and `tapErr` operate
on typed `E`. Runtime faults and cleanup failures stay on the `UnhandledException` channel so
"handle all errors" helpers cannot accidentally swallow teardown corruption or unknown throws.

**Cleanup faults use the same channel.** When registered exit finalizers throw after the body
settles, the observable outcome becomes `Err(UnhandledException)` with the cleanup fault as
`cause`, even if the body already returned typed `Err` (Invariant 2 in `DESIGN.md`).

## Why not fold everything into E?

**Domain types would lie.** Callers model `E` as expected failure modes (validation, not-found,
timeout when explicitly widened). Mixing unknown throws and finalizer faults into `E` forces every
consumer to treat "my error union" as "any possible failure," erasing the typed-error benefit.

**Silent recovery is unsafe.** Allowing `recover` on `UnhandledException` would let a broad handler
mask generator misuse, invalid instructions, or cleanup bugs as recovered success paths.

**Promise rejection at the boundary hides the model.** Returning `Result` keeps failure handling
explicit and uniform across sync inspection and `await`; throwing from `.run()` would split the
mental model between typed ops and bare promises.

## Considered options

**Expose only `E` and throw for runtime faults.** Rejected: breaks the Result-first contract and
makes composition inside generator bodies inconsistent with the `.run()` edge.

**Make `UnhandledException` recoverable like any `E`.** Rejected: collapses the safety boundary
between expected and unexpected failure; see `recover` docs in `packages/op/README.md`.

**Hide `UnhandledException` from the public result type.** Rejected: callers would unsoundly narrow
`E` and miss cleanup and runtime faults that tests and observability depend on.

## Consequences

- New builders and combinators should map unexpected failure to `UnhandledException` (or typed
  `Err` when the failure is truly part of `E`), not throw through exported functions.
- Error-aware fluent transforms must filter `TimeoutError` and avoid treating `UnhandledException`
  as user `E`; ADR 0007 records the plan-node model that enforces this boundary.
- `DESIGN.md` documents finalizer precedence and `Op.try` mapping; this ADR documents why the
  second error channel exists and stays non-recoverable through user transforms.
