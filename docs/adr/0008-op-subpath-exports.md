---
status: proposed
title: Op-native modules ship as @prodkit/op subpath exports
packages:
  - "@prodkit/op"
---

# Op-native modules ship as @prodkit/op subpath exports

`@prodkit/std` was introduced as a companion package for op extensions such as DI. In practice it
shipped only DI while adding a second install, peer dependency alignment, and separate release
smoke. Core op features that already depend on the driver do not benefit from living in another
npm package.

## Decision

Capabilities that build on `@prodkit/op`, are runtime-agnostic, and depend only on
`better-result` (plus op itself) ship as **subpath exports on `@prodkit/op`**, not as separate
npm packages.

```txt
@prodkit/op              core runtime (Op factory, combinators, .run(), lifecycle)
@prodkit/op/internal     low-level extension surface for third-party library authors
@prodkit/op/di           dependency tokens, inject, provide, scoped/singleton bindings
@prodkit/op/policy       policy constructors and Delay helpers (see ADR 0009)
```

Each subpath is a separate tsdown entry and `exports` map entry. The main `@prodkit/op` entry must
not re-export subpath modules.

## Placement criteria

| Criterion | `@prodkit/op/<name>` subpath | Separate package |
| --- | --- | --- |
| Builds on or is specific to op | yes | optional |
| Runtime-agnostic | yes | optional |
| Third-party runtime deps beyond `better-result` | no | yes |
| Platform-specific (Node-only, DOM-only, etc.) | no | yes |
| Optional for most op users | yes (subpath) | yes |

Examples: DI and policy constructors are op subpaths. A future OpenTelemetry adapter or env module
built on a validation library is a separate package.

## `@prodkit/std`

After DI moves to `@prodkit/op/di`:

- Hard-cutover imports from `@prodkit/std/di` to `@prodkit/op/di`.
- Remove `@prodkit/std` from publish, examples smoke, release tooling, and gate.
- Reserve `@prodkit/std` only if a future module needs third-party deps or does not fit the op
  subpath criteria. Do not recreate a parallel stdlib layer for op-native features.

## Considered options

**Keep `@prodkit/std` for all op extensions.** Rejected: version skew between op and std, extra
install for features that always need the driver, and no meaningful bundle isolation when std
already externalizes op.

**Separate packages per feature (`@prodkit/di`, etc.).** Rejected: same install and release cost
without clearer boundaries than subpath exports.

**Re-export subpaths from the root `@prodkit/op` entry.** Rejected for now: grows the default
import and CI bundle-size baseline (`dist/index.mjs`) for users who never use DI or policy
constructors.

## Consequences

- Add op subpaths via move-first source layout under `packages/op/src/<name>/`, separate tsdown
  entries, and `package.json` `exports` entries. Tests live under `packages/op/tests/`.
- Consumers import subpaths explicitly (`@prodkit/op/di`, `@prodkit/op/policy`). Library authors
  extending the driver continue to use `@prodkit/op/internal`.
- CI `bundle-size` continues to measure only the main `@prodkit/op` entry.
- Do not add op-native, runtime-agnostic, `better-result`-only modules as separate npm packages
  without a new ADR.

## Implementation

- [#128](https://github.com/trvswgnr/prodkit/issues/128): Move DI to `@prodkit/op/di` and retire `@prodkit/std`.
- Policy subpath and `.with(Policy.*)` cutover: ADR 0009 ([#129](https://github.com/trvswgnr/prodkit/issues/129), [#130](https://github.com/trvswgnr/prodkit/issues/130), [#131](https://github.com/trvswgnr/prodkit/issues/131)).
