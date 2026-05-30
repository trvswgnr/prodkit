---
status: accepted
title: run takes args only; cancellation and policy compose fluently
packages:
  - "@prodkit/op"
---

# run takes args only; cancellation and policy compose fluently

`op.run(...args)` and `Op.run(op, ...args)` execute an operation with call arguments only. Run
configuration (abort signals, retry, timeout, and other policies) attaches through fluent methods
on the op before `.run()`, not through extra parameters on `.run()` itself.

ADR 0009 later narrowed built-in execution policy attachment to `.with(Policy.*)` for retry,
timeout, cancel, and release. The args-only `.run()` decision here still holds.

## Decision

**Args-only `.run()`.** `runOp` in `packages/op/src/core/run-op.ts` binds a fresh
`AbortController` signal when no cancel policy was composed. Tuple arguments flow from
`op(...args)` into `createRunContext(..., args)` for lifecycle hooks; they are not a general
options bag.

**Policy stacks on the op value.** `.with(Policy.retry(...))`, `.with(Policy.timeout(...))`,
`.with(Policy.cancel(...))`, `.with(Policy.release(...))`, transforms, and lifecycle hooks compose
left-to-right on the callable op object. Method order defines wrapper nesting (documented under
policy ordering in `DESIGN.md`).

**Static `Op.run` is sugar, not a second config surface.** `Op.run(op, ...args)` delegates to
`op(...args).run()` with the same semantics; it does not accept signals or policies.

## Why not pass options to run?

**Composition stays visible in the value.**
`fetchUser(id).with(Policy.timeout(1000)).with(Policy.cancel(signal))` shows the full execution
contract at the call site. Hiding retry or timeout in `run(id, { timeoutMs })` splits "what the op
is" from "how it runs" and makes reused op values ambiguous (same op, different run options in
different callers).

**Tuple arity stays honest.** `A` in `Op<T, E, A, M>` is call arguments flowing into
`EnterContext` / `ExitContext`, not a merged args-plus-options tuple. Mixing options into `.run()`
would collide with multi-argument ops and complicate type inference for generator-defined ops.

**Policies participate in plan composition.** Retry, timeout, and cancel attach through structural
plan nodes (ADR 0007). Treating them as ephemeral run parameters would bypass that composition
model and reintroduce outer-shell-only policy bugs on wrapped ops.

## Considered options

**`run(...args, { signal, timeoutMs })` overload.** Rejected: options arity collides with
legitimate last-arg values, encourages one-off config that bypasses composable op values, and
duplicates the fluent surface.

**Separate `runWith(context)` entrypoint.** Rejected: two execution APIs for the same op increase
documentation and test matrix cost without a clearer model than fluent composition.

**Implicit global or ambient signal.** Rejected: breaks runtime-agnostic, explicit cancellation;
callers must thread `AbortSignal` through `.with(Policy.cancel(...))` per run intent.

## Consequences

- Do not add cancellation, timeout, or retry parameters to `.run()` or `Op.run`; extend fluent
  policy attachment or document new constructors if a policy is missing.
- Extension packages that block `.run()` until metadata is satisfied still use fluent composition
  for policies on the unblocked op.
- README documents usage patterns; this ADR documents why execution configuration stays off the
  `.run()` parameter list.
