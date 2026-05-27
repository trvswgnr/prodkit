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

- **`makeCoreOp`** (`packages/op/src/core/fluent-nullary.ts`) builds nullary core ops. Every
  combinator, policy wrapper, and fluent transform that participates in `yield*` / `drive()` runs
  at this arity.
- **`makeFluentOp` / `liftOp`** (`packages/op/src/core/fluent.ts`) decorate a
  `(...args: A) => Op<T, E, [], M>` invoke function with the callable-plus-methods surface
  (`op(args)` and `op.map(...)` on one object). **`makeArityOp`** in `builders.ts` applies the
  same lifting to generator-defined ops via `fromGenFn`.

Policy and transform composition always maps through nullary core ops internally; lifting only
re-attaches tuple call signatures and iterator bridging for `yield*` interop.

## Why not one path?

**The driver only needs iterators.** `runOp` / `drive` never call `op(...args)`. Args are bound
once at the public boundary (`invoke(...args)` or `createRunContext(..., args)` for exit hooks)
and the rest of the stack sees `Op<T, E, [], M>`. Building everything at tuple arity would
thread unused argument types through every core combinator and policy implementation.

**The public API needs callable ops.** Callers expect `fetchUser(id).run()` and
`fromGenFn(function* (id) { ... })` to preserve `(id)` in the type signature. TypeScript also
needs the tuple `A` to flow into lifecycle hooks (`EnterContext`, `ExitContext`) without
reflecting on function arity at runtime.

**These are not duplicate implementations.** Core ops hold the generator and `OpHooks`; lifted
ops are a thin invoke wrapper plus handler delegation. `liftOp` re-wraps after each transform so
policies compose on the inner nullary op and the outer arity stays stable.

## Consequences

- New core combinators should target `makeCoreOp` / nullary `Op<..., [], M>` first, then expose
  arity through `liftOp` or `makeArityOp` if the operation is user-facing.
- `asOpInterface` and related casts exist because TypeScript cannot infer the callable-plus-methods
  intersection after `Object.assign`; that limitation is structural, not a missing refactor.
- `DESIGN.md` documents execution invariants for the nullary driver; this ADR documents why arity
  lifting is a separate layer.
