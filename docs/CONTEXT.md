# prodkit context

Shared vocabulary and documentation roles for the `prodkit` monorepo. Use this file to pick the
right doc before diving into code.

## Packages

| Package | Role |
| --- | --- |
| `@prodkit/op` | Runtime-agnostic operation library: typed async composition, policies, combinators, DI subpath |
| `@prodkit/std` | Reserved runtime-agnostic utilities (no `@prodkit/op` dependency); example subpath `@prodkit/std/array` |
| `@prodkit/shared` | Private workspace globals, publishable tsconfig/vitest presets, and runtime primitives (not published) |
| `@prodkit/examples` | Consumer smoke and sample apps |
| `@prodkit/benchmarks` | Performance harnesses |
| `@prodkit/tools` | Maintainer scripts (ADR index sync, release cut, smoke harnesses) |

Op-native extension modules (DI, policy, HKT, internal helpers) ship as `@prodkit/op` subpath
exports, not separate npm packages or `@prodkit/std` modules. Full placement rules:
[Where new code lives](#where-new-code-lives) and [ADR 0008](adr/0008-op-subpath-exports.md).

### Path cheat sheet

| Path | Workspace | Audience |
| --- | --- | --- |
| `packages/op/` | `@prodkit/op` | Published operation runtime and subpaths |
| `packages/std/` | `@prodkit/std` | Published utilities with no `@prodkit/op` dependency |
| `packages/shared/` | `@prodkit/shared` | Private presets and workspace primitives (not on npm) |
| `examples/` | `@prodkit/examples` | Consumer samples and smoke; layout in `examples/README.md`, topic index in `examples/op/README.md` |
| `benchmarks/op/` | `@prodkit/benchmarks` | Performance and bundle-size harnesses for op |
| `tools/checks/` | `@prodkit/tools` | Gate doc and contract checks |
| `tools/smoke/` | `@prodkit/tools` | Consumer pack and alternate-runtime smoke harnesses |
| `tools/release/` | `@prodkit/tools` | Release cut and per-package changelog checks |
| `tools/lib/` | `@prodkit/tools` | Shared maintainer script helpers |

## Where new code lives

Use this table when adding a feature. Rationale and examples:
[ADR 0008](adr/0008-op-subpath-exports.md).

| Situation | Home |
| --- | --- |
| Builds on `Op`, plans, policies, or DI; runtime-agnostic; depends only on `@prodkit/op` and `better-result` (existing op peer) | `@prodkit/op/<subpath>` (for example `@prodkit/op/policy` for a circuit-breaker policy) |
| Runtime-agnostic utilities that do not import `@prodkit/op` | `@prodkit/std/<subpath>` (for example `@prodkit/std/array`) |
| Platform-specific (Node-only CLI adapter, DOM-only helper) | New `@prodkit/*` package under `packages/` |
| Hard dependency on an integration SDK (OpenTelemetry, a validation stack, an HTTP framework) | New `@prodkit/*` package under `packages/` |
| Workspace-only types, casts, or toolchain presets | `@prodkit/shared` (private; not published) |

**Op subpath allowlist:** `@prodkit/op` and `better-result` only. Do not add other runtime or
integration dependencies to op subpath modules; those belong in a separate package so default
`@prodkit/op` installs stay lean.

**Std constraints:** no `@prodkit/op` dependency; prefer zero runtime dependencies and
tree-shakeable subpaths. Do not put op-native features on std.

**New packages:** add `packages/<name>/`, workspace entry in `pnpm-workspace.yaml`, and an ADR when
the boundary choice is not already covered by ADR 0008.

## Domain vocabulary (`@prodkit/op`)

| Term | Meaning |
| --- | --- |
| **Op** | Callable operation value; generator-defined work composes with `yield*`. Public tuple arity; internally nullary at the driver. |
| **Plan** | Internal execution AST under `plan/`. Fluent methods, policies, combinators, and DI `provide` are plan nodes. |
| **Instruction** | Yielded discriminant the driver dispatches (`Suspend`, exit finalizer registration, `CustomInstruction`, terminal `Err`). |
| **Policy** | Retry, timeout, cancel, release, or custom attachment applied with `.with(Policy.*)` before `.run()`. |
| **Blocking** | Metadata key marking an unsatisfied requirement (for example missing DI binding) that blocks `.run()` at the type level. |
| **Settlement** | Contributor-facing named operations for cooperative, rejecting, interrupting, or interrupt-and-drain nested work. Driver-only abort mechanics live separately in `execution/abort-settlement.ts`. |
| **UnhandledException** | Non-recoverable runtime channel from `better-result`; wraps invalid yields, cleanup faults, and validation failures. |
| **ErrorGroup** | Aggregate error preserving multiple failures (`Op.any` when all fail; cleanup settlement with message `Operation cleanup failed`). |

## Which doc to read

| Question | Start here |
| --- | --- |
| How do I install and use `@prodkit/op`? | [`packages/op/README.md`](../packages/op/README.md) (hub + core API; ships on npm) |
| Subpaths, lifecycle, cancellation depth | [`packages/op/docs/`](../packages/op/docs/README.md) (ships on npm) |
| Why was it built this way? | [`docs/adr/README.md`](adr/README.md) (monorepo only) |
| How does execution flow through modules? | [`docs/contributor/runtime-architecture.md`](contributor/runtime-architecture.md) |
| What must stay true at run time? | [`docs/contributor/op-invariants.md`](contributor/op-invariants.md) |
| Where should a new module live (op subpath, std, or new package)? | [Where new code lives](#where-new-code-lives), [ADR 0008](adr/0008-op-subpath-exports.md) |
| Where are runnable consumer examples and smoke? | [`examples/README.md`](../examples/README.md), [`examples/op/README.md`](../examples/op/README.md) |
| How do I set up, test, and release? | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| How should durable docs be written? | [Evergreen writing](#evergreen-writing) (this file) |
| How does `@prodkit/op` compare to Effect / neverthrow? | [`packages/op/docs/comparison.md`](../packages/op/docs/comparison.md) (ships on npm) |
| What is the runtime overhead? | [`packages/op/docs/performance.md`](../packages/op/docs/performance.md) (ships on npm) |
| What changed in the last release? | Package `CHANGELOG.md` under `packages/op` or `packages/std` |

## Documentation boundaries

- **Consumer docs** (`packages/op/README.md`, `packages/op/docs/`, changelogs): outcome-focused usage and stable semantics. Avoid issue checklists and migration status.
- **ADRs** (`docs/adr/`): evergreen decision records (why). Track implementation in GitHub issues, not ADR bodies.
- **Contributor docs** (`CONTRIBUTING.md`, `docs/contributor/`): setup, gate, release, code navigation, and runtime invariants. Not duplicated in package READMEs.
- **Agent memory** (`AGENTS.md`): agent environment quirks, user preferences, and workflow defaults; not consumer-facing. Repo facts live in the docs above.

When behavior changes, update the consumer-facing doc first (`packages/op/README.md` or
`packages/op/docs/`), then `docs/contributor/op-invariants.md` if the contract changed, then add or
supersede an ADR when the decision itself changed.

## Evergreen writing

Write docs so they stay useful after refactors, releases, and issue closure. Prefer durable facts
(decisions, contracts, outcomes) over pointers that rot quickly.

**Avoid in prose (especially ADRs and consumer guides):**

- GitHub issue or PR numbers, sprint or milestone labels, and "tracked in #N" delivery status.
- "For now", "soon", "will be added", "not yet", and other schedule language unless the doc is a
  changelog entry or an explicit `proposed` ADR.
- Line-number citations into source; link modules or symbols and let readers search.
- Duplicate version pins when `package.json`, `.nvmrc`, or CI already define them (contributor setup
  may name the supported Node/pnpm line once; do not scatter patch versions through unrelated docs).
- Hand-maintained benchmark numbers outside the generated performance snapshot block in
  `packages/op/docs/performance.md` (refresh with `performance:sync`, documented in
  `CONTRIBUTING.md`).

**Appropriate to name when it helps readers act:**

- npm package and subpath names, public API symbols, and stable user-visible behavior.
- Module paths and ADR numbers in contributor architecture docs (navigation, not delivery trackers).
- CI workflow files and maintainer script names in `CONTRIBUTING.md` and `benchmarks/op/README.md`.
- Machine-generated snapshot metadata (commit, date, version) inside the performance snapshot
  markers; treat that block as generated output, not hand-written narrative.
- Changelog sections under `## [Unreleased]` and released version headings (historical record).

**ADRs:** state the decision and why alternatives were rejected; do not embed open worklists. When
a decision changes, supersede with a new ADR per [`docs/adr/README.md`](adr/README.md).

**Consumer docs:** describe what callers get today; put alpha or stability expectations in one clear
notice (for example `packages/op/README.md`) instead of repeating release-phase language across
guides.
