---
status: accepted
title: Three cleanup channels stay separate by design
packages:
  - "@prodkit/op"
---

# Three cleanup channels stay separate by design

Teardown in `@prodkit/op` flows through three mechanisms that look similar in user code but serve
different roles in the runtime. They are not three implementations of one abstraction.

## Decision

**Generator finalization (`closeGenerator`).** When `drive` finishes or short-circuits, it calls
`iterator.return()` through `closeGenerator` in `packages/op/src/core/cleanup.ts`. This runs
synchronous native `finally` blocks in the generator body. Faults from `return()` are swallowed so
the body result already chosen by `drive` is preserved. Yielded or async work inside `finally` is
not driven after early exit.

**Registered exit finalizers (`Op.defer`, `.on("exit", ...)`).** Effectful cleanup registers through
`RegisterExitFinalizerInstruction`. Finalizers unwind last-in-first-out via `runFinalizersSafely`.
Every registered handler runs even when a sibling throws. Once the body has settled, a finalizer
fault wins the observable outcome as `Err(UnhandledException)` (with nested `cause` links when
several throw).

**Success-gated release (`.with(Policy.release(...))`).** `withReleasePlan` in `packages/op/src/core/plan/lifecycle.ts`
drives the inner op first. On typed failure it returns without scheduling release. On success it
registers a single exit finalizer that runs the release hook. Primary domain errors stay intact;
release is for acquired resources after successful completion, not for every exit path.

`Op.defer` and `.on("exit")` share the exit-finalizer stack with release hooks registered by
`.with(Policy.release(...))`; LIFO ordering applies across all of them.

## Why not one path?

**Generator `finally` cannot carry effectful cleanup.** `closeGenerator` is best-effort and
non-suspending. Cleanup that must `yield*`, observe abort signals, or change the settled `Result`
belongs on the exit-finalizer path (`Op.defer`, `.on("exit")`) or, for success-only resource
release, `.with(Policy.release(...))`.

**Exit finalizers must not inherit generator `return()` semantics.** Swallowing finalizer faults
would hide teardown corruption. Registered finalizer failure taking precedence at settlement is
Invariant 2 in `op-invariants.md`; generator finalization intentionally does the opposite so body errors
stay visible when native `finally` misbehaves.

**`Policy.release` is not a synonym for defer.** Running release on typed failure would convert
domain errors into cleanup noise or double-report failures. Success-gating matches acquire/use/release
for values the op produced, not unconditional shutdown telemetry.

## Considered options

**Route all cleanup through exit finalizers only.** Rejected: would lose cheap synchronous
`finally` unwinding and force every generator author through defer registration for simple scopes.

**Unify fault handling so `return()` and finalizers share precedence rules.** Rejected: conflates
best-effort generator hygiene with effectful teardown contracts callers rely on for observability.

**Make release policy run on failure like defer.** Rejected: release hooks often assume a successful
value; running them on `Err` duplicates error paths and breaks tests that expect primary errors to
surface unchanged.

## Consequences

- Do not move effectful or suspending cleanup into bare generator `finally` blocks; use
  `Op.defer`, `.on("exit")`, or `.with(Policy.release(...))` as appropriate.
- Do not merge `closeGenerator` fault handling with `runFinalizersSafely`; the asymmetry is the
  contract.
- `op-invariants.md` documents LIFO ordering, finalizer precedence, and release success-gating as
  invariants; this ADR documents why three channels remain distinct.
