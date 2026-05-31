---
status: accepted
title: DI dependency tokens match by class reference at runtime
packages:
  - "@prodkit/op"
---

# DI dependency tokens match by class reference at runtime

`RequiredDeps`, `DI.provide`, and `DI.inject` track dependency slots by **token class** at compile
time. Runtime matching previously also treated equal `key` strings as the same slot, which made
two distinct token classes alias and broke duplicate detection when both were provided.

## Decision

A dependency slot is identified by **token class reference** (`dependency === providedToken`).
The `key` string on `DI.Dependency("...")` is diagnostic only: error messages and logging, not
slot identity.

Two classes that share the same `key` (for example `ConfigA` and `ConfigB` both extending
`DI.Dependency("Config")`) are **distinct slots**. Providing one does not satisfy `inject` on
the other. Providing both is valid and does not throw `DuplicateDependencyError` unless the
**same class** is bound twice.

## Considered options

- **Global string-key registry:** same `key` means one runtime slot. Rejected because it fights
  the class-token API and would require reworking `RequiredDeps` around string keys instead of
  constructors.
- **Symbol keys:** nominal keys via `unique symbol` or `Symbol(...)`. Rejected for this slice;
  class reference already provides nominal identity aligned with TypeScript.

## Consequences

- `MissingDependencyError.key` and `DuplicateDependencyError.key` may repeat across unrelated
  token classes; use the token class in types and stack traces for disambiguation.
- Alpha hard cutover: no migration path for code that relied on string-key aliasing (none found
  in repo examples or tests).

## Implementation

- GitHub #148 (design), #149 (runtime fix and regression tests)
- `@prodkit/op/di` README contract and `Dependency` JSDoc
