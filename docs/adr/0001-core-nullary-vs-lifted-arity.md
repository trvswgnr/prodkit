---
status: accepted
title: Core driver uses nullary ops; public API preserves tuple arity
packages:
  - "@prodkit/op"
---

# Core driver uses nullary ops; public API preserves tuple arity

The generator runtime (`drive` in `packages/op/src/core/runtime.ts`) executes
`Op<T, E, [], M>`: nullary ops whose iterator is the only execution entry point.
User-facing ops are `Op<T, E, A, M>` where `A` is a tuple of call arguments. Those two shapes
serve different consumers and stay as separate construction paths rather than one unified builder.

## Decision

- **`makeCoreOp`** (`packages/op/src/core/fluent.ts`) builds nullary core ops from
  generator leaves. Every leaf that participates in `yield*` / `drive()` still has a nullary
  iterator surface.
- **`makePlanOp`** (`packages/op/src/core/plan/`) decorates a `bindArgs(...args) -> Plan<T, E>`
  function with the callable-plus-methods surface (`op(args)` and `op.map(...)` on one object).
  `fromGenFn` uses the same plan binder for generator-defined ops.

Policy and transform composition now rewrites internal plan nodes. Tuple arguments are bound at
the public shell, while iterator bridging keeps nullary `yield*` interop intact.

## Why not one path?

**The driver only needs iterators.** `runOp` / `drive` never call `op(...args)`. Args are bound
once at the public boundary (`invoke(...args)` or `createRunContext(..., args)` for exit hooks)
and the rest of the stack sees `Op<T, E, [], M>`. Building everything at tuple arity would
thread unused argument types through every core combinator and policy implementation.

**The public API needs callable ops.** Callers expect `fetchUser(id).run()` and
`fromGenFn(function* (id) { ... })` to preserve `(id)` in the type signature. TypeScript also
needs the tuple `A` to flow into lifecycle hooks (`EnterContext`, `ExitContext`) without
reflecting on function arity at runtime.

**These are not duplicate implementations.** Core ops provide generator leaves. The plan shell
binds tuple args to a plan once per run, then fluent transforms produce structural plan nodes so
policies compose on the intended inner work and the outer arity stays stable.

## Consequences

- New core combinators should target plan nodes first, then expose arity through `makePlanOp` if
  the operation is user-facing.
- Brand and `Object.assign` coerces exist because TypeScript cannot infer the callable-plus-methods
  intersection after `Object.assign`; that limitation is structural, not a missing refactor.
- `DESIGN.md` documents execution invariants for the nullary driver; this ADR documents why arity
  lifting is a separate layer.
