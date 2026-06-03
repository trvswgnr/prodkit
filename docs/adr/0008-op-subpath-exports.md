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

Examples:

- **Op subpath:** DI, policy constructors, HKT; a future circuit-breaker policy that composes with
  `Policy` and the plan driver (runtime-agnostic, no integration SDK).
- **Std subpath:** array, object, string, and encoding helpers that do not import `@prodkit/op`.
- **Separate package:** OpenTelemetry telemetry bridge, a Node-specific CLI adapter, or any module
  that depends on a platform or third-party integration stack beyond `better-result`.

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

**Retire `@prodkit/std` after DI moves.** Rejected: `@prodkit/std` is reserved for general
runtime-agnostic utilities; the package name and publish pipeline stay useful once op-specific code
leaves.

**Separate npm package per op-native feature (`@prodkit/di`, `@prodkit/policy`, etc.).** Rejected for
portable op extensions: same install and release cost without clearer boundaries than subpath exports.
Integration and platform adapters still ship as their own packages when they pull in otel, Node APIs,
or other non-peer dependencies.

**Re-export subpaths from the root `@prodkit/op` entry.** Rejected: grows the default import and CI
bundle-size baseline (`dist/index.mjs`) for users who never use DI or policy constructors.

## Consequences

- Add op subpaths via move-first source layout under `packages/op/src/<name>/`, separate tsdown
  entries, and `package.json` `exports` entries. Tests live under `packages/op/tests/`.
- Consumers import op subpaths explicitly (`@prodkit/op/di`, `@prodkit/op/policy`).
- CI `bundle-size` continues to measure only the main `@prodkit/op` entry.
- Do not add op-native modules to `@prodkit/std`. Use op subpaths for portable op extensions; add a new
  package (and ADR when the choice is non-obvious) for platform-specific or integration-SDK adapters.
- `@prodkit/std` drops its `@prodkit/op` peer dependency once DI leaves; std utilities should not
  require op unless a specific module documents that coupling.
- Policy constructor placement and `.with(Policy.*)` attachment: [ADR 0009](0009-policy-with-attachment.md).
