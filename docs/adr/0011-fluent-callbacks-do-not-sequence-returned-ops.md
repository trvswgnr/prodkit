---
status: accepted
title: Fluent callbacks do not sequence returned ops
packages:
  - "@prodkit/op"
---

# Fluent callbacks do not sequence returned ops

The fluent callback methods `.tap(...)`, `.tapErr(...)`, and `.recover(...)` previously blurred
observation, fallback values, and operation sequencing. Returning an `Op` from those callbacks could
look like explicit composition, but the callback surface did not make it obvious whether the returned
operation would be run, ignored, or treated as data.

An earlier direction would have executed nullary ops returned from callbacks, which requires knowing
whether a generator-built op is nullary or parameterized before invocation. Without a trustworthy
runtime witness, that model is unsafe.

## Decision

**Callback returns are not sequencing signals.** `.tap(...)` and `.tapErr(...)` await the callback
for thrown or rejected failures, then ignore the callback return value. Returning an `Op` from either
observer does not run that op and does not merge its error or metadata channels.

**Recovery handlers return fallback data.** `.recover(predicate, handler)` awaits the handler and
uses that value as the recovered success value. If the handler returns an `Op`, the op is returned as
data. It is not driven, and its error or metadata channels are not merged.

**Operation sequencing stays explicit.** Code that needs to run another operation must use
`.flatMap(...)` or a generator body with `yield*`:

```ts
const withAudit = saveUser.flatMap((user) =>
  writeAudit(user.id).map(() => user),
);

const recovered = Op(function* () {
  const user = yield* loadUser;
  yield* writeAudit(user.id);
  return user;
});
```

## Why not implicit returned-op driving?

**It makes callback returns magic.** `tap` and `tapErr` are observation APIs. Running an operation
because the callback happened to return an op changes the operation graph through a value that looks
discarded. That makes failures, dependencies, metadata, timing, and cancellation harder to reason
about at the call site.

**It weakens type and runtime alignment.** If runtime only drives some returned ops, the type surface
needs to expose which returned values count as sequenced operations. A public `BoundOp` marker would
make the distinction typeable, but it leaks an implementation boundary into everyday user code and
still preserves the surprising callback-return execution model.

**Arity probing is not acceptable.** Function `.length`, source parsing, and similar reflection are
not reliable enough to decide whether a generator factory is nullary. Default parameters, rest
parameters, and transpilation can all make the apparent arity disagree with the public `Op` type.

## Considered options

**Execute every returned nullary `Op`.** Rejected: an earlier explored direction, but it
requires a trustworthy nullary witness for uninvoked generator factories. Adding that witness would
be a larger public/runtime shape change, and the behavior still makes callback returns implicit
sequencing.

**Execute only already-bound ops.** Rejected: this avoids arity reflection but creates a subtle
runtime distinction between `op` and `op()`. It also requires exposing or inferring a bound-op type
for callbacks, worsening DX without removing the magic.

**Keep prior behavior but document it.** Rejected: documentation cannot make hidden sequencing
obvious enough. The callback methods should have local, predictable return semantics.

## Consequences

- `.tap(...)` and `.tapErr(...)` preserve the source success, error, and metadata channels except
  for thrown or rejected callback failures surfacing as `UnhandledException`.
- `.recover(...)` removes only the handled typed error branch and widens success with
  `Awaited<ReturnType<handler>>`; returned ops are success data.
- Dependencies and other extension metadata from callback-returned ops do not bubble through these
  methods. Use `flatMap` or `yield*` when those requirements must participate in the parent op.
- Direct `yield* nullaryOp` remains supported. Parameterized ops still require explicit invocation
  before composition.
