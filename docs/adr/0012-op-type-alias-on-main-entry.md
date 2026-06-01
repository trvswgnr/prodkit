---
status: accepted
title: Op type alias stays on main entry for declaration emit
packages:
  - "@prodkit/op"
---

# Op type alias stays on main entry for declaration emit

Internal `@prodkit/op` modules (for example `core/plan/surface.ts`) reference the branded `Op` type in
fluent interfaces and inference helpers. A natural refactor is to extract `Op` into a dedicated
module so core stops importing from the package entry. Issue [#155](https://github.com/trvswgnr/prodkit/issues/155)
proposed that shape and was closed wontfix after review.

## Decision

**The canonical `Op` type alias lives on `packages/op/src/index.ts`**, merged with the `Op` factory
const:

```ts
export type Op<T, E, A, M = EmptyMeta> = OpInterface<T, E, A, M> & Tagged<"Op">;
export const Op = Object.assign(fromGenFn, { /* ... */ });
```

Internal modules that need the branded alias use **`import type { Op } from "../index.js"`** (or the
equivalent relative path). Do not duplicate the alias in another module to avoid that import.

## Why not a dedicated brand module?

**Published declarations stay clean.** tsdown/rolldown emits declaration chunks per module graph.
Duplicating `Op` in a separate file (for example `core/op-brand.ts`) produces a second declaration
site. Consumer-facing `.d.mts` then surfaces mangled duplicates such as `Op$1` instead of one
canonical `Op`.

**Const/type merge requires the entry.** The public `Op` value and `Op` type intentionally share a
name on the main entry. Re-exporting the type from elsewhere does not participate in that merge the
same way and breaks generic typing against the factory namespace.

**The import is type-only.** `import type` is erased at compile time. The `index.ts` -> `core/*` ->
`index.ts` edge is not a runtime circular dependency and does not affect bundle execution.

## Considered options

**Duplicate `Op` in `core/op-brand.ts` and re-export from the entry.** Rejected: duplicate
declaration emit (`Op$1`) and fragile const/type merge (see #155 experiment).

**Stop referencing `Op` in core; use `OpInterface` everywhere.** Rejected: fluent return types and
inference helpers (`InferOpOk`, `InferOpErr`, `AnyNullaryOp`) need the branded alias for the public
contract tests and IDE experience to match runtime values.

## Consequences

- Refactors may keep `import type { Op } from "../index.js"` in core modules; that is intentional.
- Splitting former `core/types.ts` (#158) should not extract the `Op` alias; colocate metadata,
  instruction protocol, run contexts, and plan surface types with their owning modules using direct
  imports (no re-export barrel).
- Subpath exports must not re-declare `Op`; they import the type from the main entry or from shared
  internal shapes (`OpInterface`) when the branded alias is not required.

## Implementation

- [#155](https://github.com/trvswgnr/prodkit/issues/155): closed wontfix; documents the rejected
  dedicated brand module approach.
