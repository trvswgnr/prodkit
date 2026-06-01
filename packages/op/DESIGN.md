# Execution invariants

This document captures correctness-critical runtime invariants for `Op` execution.
It focuses on semantics that should remain stable across refactors.

## Scope and model

`Op.run()` is driven by `drive()` in `packages/op/src/core/runtime.ts`.
That runtime executes generator instructions, tracks registered exit finalizers, and settles to a single `Result`.
Combinators (`Op.all`, `Op.allSettled`, `Op.any`, `Op.race`) compose multiple `drive()` calls in `packages/op/src/combinators.ts`.

## Invariant 1: cleanup ordering is deterministic and LIFO

When multiple exit finalizers are registered, unwind order is last-in-first-out. Every registered finalizer is attempted, even if earlier unwind steps throw.

Why this matters:

- resource scopes are stack-shaped, so teardown must run in reverse acquisition order
- cleanup side effects must be predictable for debugging and auditing

Enforced by code paths:

- `packages/op/src/core/runtime.ts` (`runFinalizersSafely`): iterates `finalizers` from tail to head and keeps unwinding after faults
- `packages/op/src/core/runtime.ts` (`chainCleanupFaults`): folds multiple cleanup faults into a nested `Error.cause` chain in unwind order

Representative tests:

- `packages/op/tests/unit/core.test.ts` (`registerExitFinalizer runs all handlers in LIFO order`)
- `packages/op/tests/unit/core.test.ts` (`multiple throwing finalizers are folded into a cause chain`)
- `packages/op/tests/unit/lifecycle-defer.test.ts` (`runs multiple defers in LIFO order on success`)
- `packages/op/tests/unit/lifecycle-defer.test.ts` (`shares LIFO stack with release policy (release runs before defer registered earlier)`)

## Invariant 2: registered exit-finalizer faults take precedence at settlement

After the body reaches a terminal `Result`, exit finalizers run. If any registered exit finalizer fails, the final outcome becomes `Err(UnhandledException)` with cleanup fault cause (or chained causes for multiple faults), regardless of prior body success/failure.

Why this matters:

- prevents silent teardown corruption
- makes cleanup failures explicit at call sites and observability boundaries

Enforced by code paths:

- `packages/op/src/core/runtime.ts` (`settleWithCleanup`): finalizer faults override settled body result
- `packages/op/src/core/runtime.ts` (`runFinalizersSafely`): returns first unwind fault (or cause chain) for wrapping

Representative tests:

- `packages/op/tests/unit/core.test.ts` (`finalizer throw after successful body converts to UnhandledException`)
- `packages/op/tests/unit/core.test.ts` (`cleanup fault takes precedence over typed body error`)
- `packages/op/tests/unit/lifecycle-defer.test.ts` (`when op fails, cleanup throws: UnhandledException with cleanup error as cause`)

Important edge distinction:

- generator finalization via `iter.return()` uses `closeGenerator()`, which intentionally swallows `return()` cleanup faults to preserve the original body result/error
- this behavior is separate from registered exit finalizers and is intentionally less intrusive

Representative test:

- `packages/op/tests/unit/lifecycle-generator-finalization.test.ts` (`preserves original Err result when cleanup throws during iter.return()`)

## Invariant 3: chain-order semantics in combinators are stable

Combinators preserve deterministic ordering guarantees while still using concurrency:

- `Op.all` / `Op.allSettled`: output ordering follows input ordering, even when completions occur out of order
- `Op.any`: when all fail, `ErrorGroup.errors` keeps input index order
- `Op.race` and `Op.any`: winner selection has precedence, but resolution waits for aborted losers to settle so their cleanup/finalizers finish before `run()` resolves

Why this matters:

- caller expectations should not depend on scheduler timing
- deterministic ordering keeps retries, logs, and assertions stable

Enforced by code paths:

- `packages/op/src/combinators.ts` (`driveAll`, `driveAllSettled`, `driveAny`, `driveRace`)
- `packages/op/src/combinators.ts` (`fanOut`): isolates child cancellation and detaches parent abort listeners on settle; `Op.all`, `Op.any`, and `Op.race` fan-out through `driveInterruptOnAbort` so aborted losers unwind even when they ignore the signal

Representative tests:

- `packages/op/tests/unit/combinators.test.ts` (`tuple of successes in input order`)
- `packages/op/tests/unit/combinators.test.ts` (`returns tuple of Result in input order`)
- `packages/op/tests/unit/combinators.test.ts` (`preserves index order when failures settle out of order`)
- `packages/op/tests/unit/combinators.test.ts` (`waits for loser finalization before returning the winner`)
- `packages/op/tests/unit/combinators.test.ts` (`waits for loser finalization before returning winner result`)
- `packages/op/tests/unit/combinators.test.ts` (`settles when a winner succeeds and a loser ignores abort`)
- `packages/op/tests/unit/lifecycle-defer.test.ts` (`Op.all([child]).with(Policy.timeout(...)) runs child Op.defer cleanup when child Op.try ignores abort`)
- `packages/op/tests/unit/di/index.test.ts` (`DI.provide(inner).with(Policy.timeout(...)) runs inner Op.defer cleanup when inner Op.try ignores abort`)
- `packages/op/tests/unit/combinators.test.ts` (`settles when the winner succeeds and a loser ignores abort`)

## Guardrails for future changes

Before changing runtime/combinator internals, preserve these properties:

1. LIFO unwind and "run all finalizers" behavior.
2. Registered finalizer failure precedence at final settlement.
3. Stable input-order semantics for combinator outputs and grouped errors.
4. Wait-for-loser-finalization semantics after winner selection.

Any intentional semantic change should include:

- explicit test updates in `packages/op/tests/unit/core.test.ts`, `packages/op/tests/unit/lifecycle-*.test.ts`, and/or `packages/op/tests/unit/combinators.test.ts`
- an accompanying update to this document explaining the new invariant

## Operational notes and references

If you change the scheduler, combinators, or policy wrappers, these are the behaviors worth
holding steady. Stuff that reads like a micro-optimization can still blow up determinism or
what callers see when something fails.

The references here are `packages/op/src/core/runtime.ts`, `packages/op/src/core/plan/`, and
`packages/op/src/combinators.ts`, plus the tests named inline so regressions stay obvious.

## Single-run driver (`drive`)

Running an `Op` is walking an iterator over `Instruction`s. `drive` in `packages/op/src/core/runtime.ts`
passes the same `AbortSignal` into suspended work (`packages/op/tests/unit/core.test.ts` "resumeSuspended path
passes the bound signal"). A typed shortcut via `yield* Result.err` settles to `Err` and still
runs exit teardown along the usual path. Yield something that isn't a known instruction shape
and you get `Err(UnhandledException(TypeError))` ("invalid yielded instructions...").

`Op.try` mapper contract (`packages/op/src/builders.ts`): `onError` returns the mapped error value (or a
`Promise` of it). If `onError` returns an `Op`/generator object, `Op.try` uses that object as the
error value and does not execute it.

### Exit finalizers (`RegisterExitFinalizerInstruction`)

Cleanup hooks go through `RegisterExitFinalizerInstruction`. For each `drive` invocation the
registered finalizers unwind last-in-first-out: `runFinalizersSafely` walks the array from the
tail (`packages/op/src/core/runtime.ts`). In one generator body, multiple defers unwind in reverse yield order
(second defer runs before the first).

Chained `.on("exit", ...)` builds plan wrappers where the hand you attach first behaves like the
inner scope, so at exit time the inner-most handler runs
before the outer ones (`packages/op/tests/unit/lifecycle-exit.test.ts`, "chains `.on("exit")` in LIFO order with inner
registration running first"). That matches how people think about stacking defer-like behavior.

Every registered finalizer still runs after a sibling throws (`runFinalizersSafely`). Several throws
collapse into nested `cause` links via `chainCleanupFaults` in LIFO order (`packages/op/tests/unit/core.test.ts`,
"multiple throwing finalizers are folded into a cause chain").

Once the body has picked a settlement `Result`, a fault in exit finalizers wins the observable
outcome as `Err(UnhandledException)`, including folded `cause` chains, even when the body had
already settled to typed `Err` ("cleanup fault takes precedence over typed body error"). Same for
successful bodies where a finalizer throws ("finalizer throw after successful body converts to
`UnhandledException`").

`.with(Policy.release(...))` is different (`packages/op/src/core/plan/lifecycle.ts`). The release hook
arms only after a successful inner completion. Typed failure short-circuits without scheduling that
release, so primary errors stay intact (`packages/op/tests/unit/lifecycle-release.test.ts`, "preserves primary error..." on
`Op.fail` with release policy). That isn't swapping semantics with exit finalizers registered while
the run is unwinding inside `drive`.

### Generator finalization (`closeGenerator`)

`drive` touches `iterator.return` through `closeGenerator` so synchronous native `finally` code runs
(`packages/op/src/core/runtime.ts`). This is best-effort generator finalization, not the effectful
cleanup path: yielded or async work inside a `finally` block is not driven after early exit. Use
`Op.defer`, `.with(Policy.release(...))`, or `.on("exit", ...)` for cleanup that must suspend, fail explicitly, or
complete before `.run()` settles. Throws from `return` are swallowed on purpose
(`packages/op/tests/unit/lifecycle-generator-finalization.test.ts`, "preserves original Err result when cleanup throws during `iter.return()`").

## Concurrency (`Op.all`, `Op.any`, `Op.race`)

Combinator contracts live in `packages/op/src/combinators.ts` alongside the fuller comment block.

`Op.all` fails fast on the first child error, aborts siblings, and waits for every active branch
to settle before returning. Fan-out children use `driveInterruptOnAbort` so aborted losers unwind
even when they ignore `AbortSignal`. The outer `SuspendInstruction` sets `drainOnAbort` so an
enclosing `Policy.timeout` can drain in-flight fan-out work before the timeout result settles.

`Op.any` runs children together under one outer abort umbrella. First success picks the winner and
abort-signals the losers, but `.run()` still waits until those aborted branches finish so cleanup
sticks ("waits for loser finalization before returning the winner"). Fan-out children use
`driveInterruptOnAbort` so losers that never observe `AbortSignal` still unwind. If everyone fails you get an
`ErrorGroup` listing errors in declaration order regardless of settle order ("preserves index order
when failures settle out of order"). A loser failing while reacting to abort does not trump the
winner's success ("winner success keeps precedence over loser abort-time failures").

`Op.race` is simpler: whoever settles first, ok or err, picks the outcome and triggers abort for
everyone else, with the same promise that losers finish teardown before `.run()` returns ("waits
for loser finalization before returning winner result"). Fan-out children use `driveInterruptOnAbort`
so losers that never observe `AbortSignal` still reject in-flight suspends and unwind. The losing
branch still can't override the chosen error ("winner error keeps precedence over loser abort-time
failures").

## Invariant: input normalization and validation at run time

Built-in policy and sleep inputs are validated when the wrapped operation first runs, not when
`Policy.retry(...)` or `Policy.timeout(...)` is attached. Invalid configuration does not throw out of
`.run()`; it settles to `Err(UnhandledException)` with the validation error as `cause`.
`TypeError` means the wrong runtime shape (for example `when` is not a function, or `retries` is
not an integer). `RangeError` means a numeric value is out of the allowed interval (for example
negative `timeoutMs`, or negative `retries`).

| Input | Treatment |
| --- | --- |
| `Op.sleep(ms)` negative | Normalize to `0` |
| `Op.sleep(ms)` non-finite | `Err(UnhandledException)` at run time |
| `Policy.timeout(timeoutMs)` negative or non-finite | `Err(UnhandledException)` at run time |
| `Policy.retry` invalid `retries`, `when`, `delay`, or delay output | `Err(UnhandledException)` at run time |
| `Delay.exponential` invalid options | Validated once per run when the retry policy executes |

Enforced by:

- `packages/op/src/policy/plan.ts` (`retryPlan`, `timeoutPlan`)
- `packages/op/src/policy/retry-policy.ts` and `packages/op/src/policy/validate.ts`
- `packages/op/src/shared.ts` (`sleepWithSignal`) via `Op.sleep`

Representative tests:

- `packages/op/tests/unit/policies.test.ts` (invalid retries, delay, when, timeout)
- `packages/op/tests/property/retry-policy.test.ts` (invalid exponential delay options)
- `packages/op/tests/unit/builders.test.ts` (sleep normalization and non-finite rejection)

## Retry policy shape

- `retries`: post-failure retry budget (`retries: 0` runs once; default `retries: 2` allows three
  total runs).
- `when(cause)`: whether to retry after a failure; receives the unwrapped cause.
- `delay`: fixed milliseconds or `(retry, cause) => ms`, where `retry` is the 0-based index of the
  upcoming retry (`0` after initial failure).
- `Delay.exponential` computes `baseMs * 2 ** retry`, capped at `maxMs`.

## Policy ordering (retry and timeout)

`.with(...)` order chooses what's inside which wrapper. Putting `Policy.retry(...)` first and
`Policy.timeout(...)` second means one overall clock around the retry loop ("timeout wraps the
entire retried run when chained outside retry"). Putting timeout inside retry means timeout
applies independently per run inside the retry loop
(`packages/op/tests/unit/policies.test.ts`, "timeout applies per-attempt when chained inside retry", also the converse
scenario in the sibling test quoted there).

Retry delay and public `Op.sleep(ms)` share the same timer adapter, so timer cleanup and abort
listener cleanup stay consistent. `Op.sleep` rejects on abort so cancellation flows through the
normal runtime `UnhandledException` channel; retry delay catches that abort and preserves its
existing "stop retrying and return the last result" behavior.

## Open policy protocol

`.with(...)` is a single generic hook over `Policy<Policy.Input<T, E, A, M>, F>` (internal name:
`OpPolicy<OpPolicyInput<T, E, A, M>, F>`).
The policy protocol lives under `packages/op/src/policy/`, while the reusable HKT encoding lives in
`packages/op/src/hkt.ts` and is exported as `@prodkit/op/hkt`. The `F` parameter is an HKT:
`HKT.PARAMS` receives `[T, E, A, M]`, and `[HKT.TYPE]` returns the next `Op<T, E, A, M>`.
Built-in policy types are just instances of that protocol, so
`Policy.timeout(...)` widens `E` with `TimeoutError` without a dedicated `.with` overload.
Custom policy authors use `HKT.Param<this, n>` to read applied slots and declare
`readonly [HKT.TYPE]: Op<...>`.

`Policy.Input` (internal: `OpPolicyInput`) is carried in a contravariant phantom slot. That is what keeps
`Policy.release((value) => ...)` contextually typed from the wrapped op's success value while still
letting universal policies use `unknown` input.

At runtime, `Policy.define(...)` builds policy values with `apply(source)`. `source.wrap(...)`
exposes direct plan transforms, `source.rewrite(...)` lets built-in policies rebuild known plan
nodes while preserving existing ordering semantics, and `source.around(...)` covers Result-level
policies that need to run before, after, or instead of the wrapped operation. Core `Plan` only knows
about the generic `PlanRewriter` protocol; retry, timeout, cancel, release, and retry delay code
live under `packages/op/src/policy/`.

## Where else to read

Cancellation and cooperative `AbortSignal` behavior show up wherever `SuspendInstruction` binds a
signal, plus README's `Op.defer` / `.on("exit")` notes and checks in `packages/op/tests/unit/policies.test.ts` and
`packages/op/tests/unit/lifecycle-*.test.ts`. Settlement intent lives in
`packages/op/src/core/cancel-session.ts`: DI lazy-resolve uses `rejectOnAbort`; Policy.cancel
uses bound-abort session composition and macrotimer fallback; driveIterator suspend resume uses
`interruptOnAbort`; combinator and DI provision drain use `drainAfterAbort` on suspend resume.
Type-level contracts collected in
`packages/op/tests/types/op.test.ts`, with custom policy spike coverage in
`packages/op/tests/unit/policy-hkt.test.ts`.

For structural rationale that complements these invariants, see [`docs/adr/`](../../docs/adr/):

- [0001](../../docs/adr/0001-core-nullary-vs-lifted-arity.md): nullary core driver vs lifted public arity
- [0007](../../docs/adr/0007-timeout-widening-at-composition-boundary.md): plan AST execution (supersedes hook-era timeout widening notes)
- [0009](../../docs/adr/0009-policy-with-attachment.md): `.with(Policy.*)` attachment surface
- [0003](../../docs/adr/0003-three-cleanup-channels.md), [0004](../../docs/adr/0004-combinators-wait-for-loser-finalization.md), [0005](../../docs/adr/0005-unhandled-exception-runtime-channel.md), [0006](../../docs/adr/0006-run-args-only-fluent-policy-composition.md): cleanup channels, combinator settlement, runtime errors, args-only `.run()`
- [0011](../../docs/adr/0011-fluent-callbacks-do-not-sequence-returned-ops.md): fluent callback return semantics
- [0012](../../docs/adr/0012-op-type-alias-on-main-entry.md): canonical `Op` type alias on main entry (declaration emit)
