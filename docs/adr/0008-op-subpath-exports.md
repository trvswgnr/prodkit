---
status: accepted
title: Op-native modules ship as @prodkit/op subpath exports
packages:
  - "@prodkit/op"
  - "@prodkit/std"
---

# Op-native modules ship as @prodkit/op subpath exports

`@prodkit/std` was introduced as a companion package for op extensions such as DI. In practice it
shipped only DI while adding a second install, peer dependency alignment, and separate release
smoke. Core op features that already depend on the driver do not benefit from living in another
npm package.

## Decision

Capabilities that build on `@prodkit/op`, are runtime-agnostic, and depend only on
`better-result` (plus op itself) ship as **subpath exports on `@prodkit/op`**, not as separate
npm packages or as `@prodkit/std` modules.

```txt
@prodkit/op              core runtime (Op factory, combinators, .run(), lifecycle)
@prodkit/op/di           dependency tokens, inject, provide, scoped/singleton bindings
@prodkit/op/policy       policy constructors and Delay helpers (see ADR 0009)
@prodkit/op/hkt          reusable HKT primitives for open type-level transforms (see ADR 0009)
@prodkit/op/internal     extension/maintainer helpers (Blocking, CustomInstruction, etc.)
```

Each subpath is a separate tsdown entry and `exports` map entry. The main `@prodkit/op` entry must
not re-export subpath modules.

## Placement criteria

| Criterion | `@prodkit/op/<name>` | `@prodkit/std/<name>` | Separate package |
| --- | --- | --- | --- |
| Builds on or is specific to op | yes | no | optional |
| General runtime utilities (not op-specific) | no | yes | optional |
| Runtime-agnostic | yes | yes | optional |
| Third-party runtime deps beyond `better-result` | no | avoid (zero-deps goal) | yes |
| Platform-specific (Node-only, DOM-only, etc.) | no | no | yes |
| Optional for most users | yes (subpath) | yes (subpath) | yes |

Examples: DI and policy constructors are op subpaths. Array, object, string, and encoding helpers
that do not depend on op are std subpaths. A future OpenTelemetry adapter or validation-library
env module is a separate package.

## `@prodkit/std`

`@prodkit/std` **remains publishable**. Its direction shifts from op companion to a **general
runtime-agnostic utility layer**: typed helpers for gaps the platform leaves, prefer-native
delegation when engines already provide the primitive, zero runtime dependencies, and
tree-shakeable subpaths (for example `@prodkit/std/array`, `@prodkit/std/object`).

Guiding constraints for std:

- Do not rebuild the platform (`structuredClone`, `Object.groupBy`, set algebra, iterator helpers).
- Prefer native at runtime; wrap only for types, cross-runtime consistency, or security hardening.
- Keep op-native features off std; they belong on `@prodkit/op` subpaths.

DI now lives on `@prodkit/op/di`:

- Hard-cutover imports from `@prodkit/std/di` to `@prodkit/op/di`.
- Remove DI from `@prodkit/std` (no compatibility re-export).
- Repurpose `@prodkit/std` for the utility-layer modules above.
- Consumer examples under [`examples/op/di/`](../../examples/op/di/).

## Considered options

**Keep `@prodkit/std` for all op extensions.** Rejected: version skew between op and std, extra
install for features that always need the driver, and no meaningful bundle isolation when std
already externalizes op.

**Retire `@prodkit/std` after DI moves.** Rejected: std will ship general utilities soon; the
package name and publish pipeline stay useful once op-specific code leaves.

**Separate packages per feature (`@prodkit/di`, etc.).** Rejected: same install and release cost
without clearer boundaries than subpath exports.

**Re-export subpaths from the root `@prodkit/op` entry.** Rejected for now: grows the default
import and CI bundle-size baseline (`dist/index.mjs`) for users who never use DI or policy
constructors.

## Consequences

- Add op subpaths via move-first source layout under `packages/op/src/<name>/`, separate tsdown
  entries, and `package.json` `exports` entries. Tests live under `packages/op/tests/`.
- Consumers import op subpaths explicitly (`@prodkit/op/di`, `@prodkit/op/policy`).
- CI `bundle-size` continues to measure only the main `@prodkit/op` entry.
- Do not add op-native modules to `@prodkit/std` or as separate npm packages without a new ADR.
- `@prodkit/std` drops its `@prodkit/op` peer dependency once DI leaves; std utilities should not
  require op unless a specific module documents that coupling.

## Implementation

- [#128](https://github.com/trvswgnr/prodkit/issues/128): Move DI to `@prodkit/op/di` and remove DI from `@prodkit/std` (done).
- Policy subpath and `.with(Policy.*)` cutover: ADR 0009 ([#129](https://github.com/trvswgnr/prodkit/issues/129), [#130](https://github.com/trvswgnr/prodkit/issues/130), [#131](https://github.com/trvswgnr/prodkit/issues/131)).
