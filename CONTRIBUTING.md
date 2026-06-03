# Contributing

## Setup

- Use Node `>=24.14.0` on the 24.x Active LTS line (current LTS; codename Krypton) and `pnpm@11` (validated in CI on `11.5.0`). Install with `npm install -g pnpm@11.5.0` or enable corepack; `.nvmrc` pins `24.14.0`.
- Dependency installs reject npm package versions published less than 24 hours ago (`minimumReleaseAge` in `pnpm-workspace.yaml`). Pin explicit versions or wait for maturity when adding fresh releases.
- Run commands from the repo root unless noted otherwise.

```bash
pnpm install
```

## Monorepo Orientation

- This repository is a pnpm workspace monorepo orchestrated by Turborepo (`turbo`).
- Root scripts (`pnpm run build|test|lint|typecheck|gate`) run across the workspace graph.
- Publishable libraries today: **`@prodkit/op`** and **`@prodkit/std`** (see `packages/op`, `packages/std`).
- Supporting workspaces: **`@prodkit/shared`** (`packages/shared`, private workspace types/config), **`@prodkit/examples`** (`examples/`), **`@prodkit/tools`** (`tools/`), **`@prodkit/benchmarks`** (`benchmarks/`).
- `@prodkit/op` landed first historically; the repo is intentionally multi-package.
- Package-scoped scripts stay in the owning workspace `package.json`; invoke them with `pnpm --filter <workspace> run <script>`.

## Documentation

`@prodkit/op` consumer docs (`packages/op/README.md`, `packages/op/docs/`) ship on npm. They cover
installation, API usage, and runtime semantics for library users. They do not link to monorepo-only
material (ADRs, contributor guides, or `docs/CONTEXT.md`).

Contributor and architecture docs live in the repo only:

- [`docs/CONTEXT.md`](docs/CONTEXT.md): domain vocabulary and which doc to open for a given question
- [`docs/contributor/`](docs/contributor/): execution module map (`runtime-architecture.md`) and
  correctness invariants (`op-invariants.md`)
- [`docs/adr/`](docs/adr/): architectural decision records (why the codebase is shaped this way).
  Index and format rules: [`docs/adr/README.md`](docs/adr/README.md). Run
  `pnpm --filter @prodkit/tools run adr:sync` after adding or editing an ADR.

When behavior changes, update consumer docs first, then `docs/contributor/op-invariants.md` if the
contract changed, then add or supersede an ADR when the decision itself changed.

## Contributor Runtime

- Node `>=24.14.0` on 24.x Active LTS is required for local development and release tasks. Node 22.x is maintenance LTS; this repo standardizes on 24.x, not 22 or 20.
- This requirement is for contributors/tooling only; the library API is runtime-agnostic for consumers.

## Local Quality Gate

Run the same checks used before publishing:

```bash
pnpm run gate
```

The quality gate includes a consumer-level smoke test that installs `@prodkit/op` and `@prodkit/std`
from `npm pack` tarballs via `examples/` in an isolated temp workspace. That harness still builds
and packs `@prodkit/std` even though `packages/std/src/` is effectively empty today: it verifies
tarball layout, `exports` wiring, and publish plumbing for the second npm package, not utility
module coverage. When `@prodkit/std` subpaths ship real code, the same pack path exercises them
without changing the gate shape.

Pull requests and pushes to `main` run the same gate in `.github/workflows/ci.yml`.
CI also publishes a Vitest coverage report as a workflow artifact (`op-coverage`) so reviewers can
audit unit, integration, type, and property-law coverage evidence from the run. `@prodkit/std`
coverage is omitted until utility modules ship in `packages/std/src/`.
CI runs `pnpm -r exec npm audit signatures` so dependency signature verification covers every
workspace package, not just the private root manifest.
An `invariants:check` gate step fails when `docs/contributor/op-invariants.md` references source symbols or test
file paths that no longer exist in the repo.
A `changelog:api:check` gate step fails when `packages/op/src/index.ts`,
`packages/op/src/di/index.ts`, `packages/op/src/policy/index.ts`, or `packages/op/src/hkt.ts`
public export names change without an update to that package's `CHANGELOG.md` under
`## [Unreleased]`. The check compares against an explicit base ref (`pull_request.base.sha` on pull
requests via `CHANGELOG_API_BASE_REF`, the pre-push commit on pushes to `main`, or
`CHANGELOG_API_BASE_REF` locally) and fails
closed when no base ref can be resolved. Internal re-export paths do not count as API changes.
A `bundle-size` job compares `@prodkit/op` lower and upper bundled size bounds (minified + gzip)
on pull requests via `compressed-size-action`; runtime regressions are tracked separately by CodSpeed
(see [`packages/op/docs/performance.md`](packages/op/docs/performance.md) and [`benchmarks/op/README.md`](benchmarks/op/README.md)).

All runnable consumer examples and smoke entrypoints live in the **`examples/`** workspace (`@prodkit/examples`):

```text
examples/
  op/                 core Op samples (combinators, defer, webhook, ...)
  op/di/              @prodkit/op/di samples (onboarding, cancellation, HTTP handler)
  std/                reserved for future @prodkit/std utility samples
  smoke.ts            runs op, di, and std smoke suites
```

## Benchmarking

Use CodSpeed (CI), the comparison harness, and the local profile harness when you need to validate runtime overhead or investigate regressions:

```bash
pnpm run bench
pnpm --filter @prodkit/benchmarks run compare
pnpm --filter @prodkit/tools run performance:sync -- --write
pnpm --filter @prodkit/benchmarks run profile
```

- CodSpeed comments on pull requests with runtime regression data; see [`benchmarks/op/README.md`](benchmarks/op/README.md).
- Bundle-size deltas appear on pull requests via the CI `bundle-size` job.
- `compare` + `performance:sync` refresh the public native-vs-Op table in [`packages/op/docs/performance.md`](packages/op/docs/performance.md).
- Use `profile.ts` locally after a CodSpeed regression to isolate overhead sources.

Detailed benchmark scenarios and authoring guidance live in `benchmarks/op/README.md`.
Published baseline interpretation lives in [`packages/op/docs/performance.md`](packages/op/docs/performance.md).

## Type Cast Policy

- Every remaining cast must carry an inline comment describing the concrete TypeScript limitation.
- Treat casts as a last resort after trying type-level restructuring first.
- New casts should be called out in PR descriptions so reviewers can audit the tradeoff.

## Testing Strategy

`@prodkit/op` keeps tests out of `src/` under `packages/op/tests/` with one file per tier:

- **Unit** (`tests/unit/`) verifies module-local invariants by importing the module under test from `../../src/...`.
- **Integration** (`tests/integration/`) verifies public API shape, re-exports, and cross-module composition contracts. Prefer importing from `../../src/index.js`; shared timing helpers live in `tests/support/`.
- **Property** (`tests/property/`) holds fast-check invariant suites (combinators, monad laws, backoff, retry).
- **Types** (`tests/types/`) holds compile-time type contracts (`expectTypeOf`, assertion types).
- **Hygiene** (`tests/hygiene/`) holds repo/API documentation checks.
- **Support** (`tests/support/`) holds shared helpers (`utils.ts`, `scheduler.ts` for fast-check schedulers).

If a behavior is an internal invariant of one module, keep it in unit; if it is a public composition/API contract, keep it in integration. Avoid duplicate assertions across tiers unless each tier validates meaningfully different risk.

**`@prodkit/op/di`** runtime tests live under `packages/op/tests/unit/di/` (for example
`index.test.ts`); compile-time DI contracts live in `packages/op/tests/types/di.test.ts`. Run
`pnpm --filter @prodkit/op run coverage` locally to reproduce CI coverage for DI and the core runtime.

## Source Layout (`@prodkit/op`)

- Public package entrypoint stays at `packages/op/src/index.ts`.
- The branded `Op` type alias stays on that entry (merged with the `Op` factory const). Internal modules use `import type { Op } from "../index.js"` when they need the alias; do not duplicate `Op` elsewhere ([ADR 0012](docs/adr/0012-op-type-alias-on-main-entry.md)).
- Re-exports from dependencies must be explicit named exports in `packages/op/src/index.ts` (never `export *`).
- Internal runtime concerns are split into focused modules under `packages/op/src/`:
  - `core/` (core operation contracts and execution runtime pieces)
  - `builders.ts` (primitive operation constructors)
  - `policy/` (retry, timeout, cancel, release policies and `Delay` helpers)
  - `hkt.ts` (reusable HKT primitives for `@prodkit/op/hkt`)
  - `combinators.ts` (all/any/race combinators)
  - `errors.ts`, `result.ts`, `tagged.ts` (shared domain contracts)
  - `shared.ts` (Op brands and `isOp` helpers only; workspace primitives import `@prodkit/shared/runtime` directly)
- `@prodkit/shared` (`packages/shared`, private): workspace globals, publishable tsconfig/vitest presets, and runtime primitives (`@prodkit/shared/runtime`). Publishable packages declare `"@prodkit/shared": "workspace:*"` and extend `@prodkit/shared/tsconfig/publishable`.
- Test layout under `packages/op/tests/`:
  - `integration/index.test.ts` for public API contract coverage
  - `unit/errors.test.ts` for typed error contracts
  - `unit/builders.test.ts` for operation builders, runtime composition, and builder type-inference contracts
  - `unit/policies.test.ts` for retry/timeout/signal behavior
  - `unit/core.test.ts` for core execution invariants
  - `unit/lifecycle-*.test.ts` for lifecycle/finalizer behavior (release, enter/exit hooks, defer, generator finalization)
  - `unit/fluent.test.ts` for fluent operator semantics
  - `unit/di/index.test.ts` for DI runtime behavior
  - `property/monad-laws.test.ts` for algebraic contract checks
  - `types/op.test.ts` for compile-time type contracts
  - `types/di.test.ts` for DI compile-time type contracts
- Runtime invariants and execution semantics are documented in `docs/contributor/op-invariants.md`.
- Structural rationale for core/fluent choices (why separate paths exist) lives in `docs/adr/`.
  Each ADR declares `title`, `status`, and `packages` in YAML frontmatter; run
  `pnpm --filter @prodkit/tools run adr:sync` after adding or editing one. Superseding and
  immutability rules: [`docs/adr/README.md`](docs/adr/README.md#updating-and-superseding).
- Implementation work is tracked in GitHub issues, not in ADR bodies or ad hoc docs under `docs/`.

## Core runtime architecture (`@prodkit/op`)

Execution-level maps (module graph, instruction lifecycle, policy wrappers, fluent transform
cookbook, DI integration, driver loop) live in
[`docs/contributor/runtime-architecture.md`](docs/contributor/runtime-architecture.md). Correctness
invariants are in [`docs/contributor/op-invariants.md`](docs/contributor/op-invariants.md); decision rationale is in
[`docs/adr/`](docs/adr/). See [`docs/CONTEXT.md`](docs/CONTEXT.md) for domain vocabulary and
which doc to open for a given question.

## Source layout (`@prodkit/shared`)

- Private workspace package under `packages/shared/`; not published to npm.
- Layout: `types/` (ambient `platform-globals.d.ts`, compile-time test helpers such as `utils.ts`), `runtime/index.ts` (workspace primitives consumed by publishable packages), `config/` (publishable tsconfig, vitest, and tsdown presets).
- Export map: `@prodkit/shared` / `@prodkit/shared/platform-globals`, `@prodkit/shared/types/utils`, `@prodkit/shared/runtime`, `@prodkit/shared/tsconfig/publishable`, `@prodkit/shared/vitest/publishable`, `@prodkit/shared/tsdown/publishable`.
- Publishable packages extend `@prodkit/shared/tsconfig/publishable` and declare `"@prodkit/shared": "workspace:*"`.

## Source layout (`@prodkit/std`)

- Source under `packages/std/src/`; published entrypoint is `@prodkit/std` (utility subpaths such as
  `@prodkit/std/array` are planned).
- Package docs: [`packages/std/README.md`](packages/std/README.md). Ship changelog: [`packages/std/CHANGELOG.md`](packages/std/CHANGELOG.md).

You can run consumer install path checks directly. Each mode builds a temporary mini-pnpm workspace (reusing `catalog:` and pnpm safety policy from `pnpm-workspace.yaml`), installs `@prodkit/op` and `@prodkit/std` from the chosen source, then runs `examples/` smoke:

```bash
pnpm --filter @prodkit/tools run examples:smoke:pack
pnpm --filter @prodkit/tools run examples:smoke:github
pnpm --filter @prodkit/tools run examples:smoke:npm
pnpm --filter @prodkit/op run test
pnpm --filter @prodkit/std run test
```

## Release Workflow (Recommended)

Publishable packages use package-scoped git tags (`op-vX.Y.Z`, `std-vX.Y.Z`).
Pushing a tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml),
which publishes the matching npm package. Legacy plain `v*` tags remain in history but
are not used for new releases.

1. Keep the package changelog updated under `## [Unreleased]` as work lands:

   - `@prodkit/op`: `packages/op/CHANGELOG.md`
   - `@prodkit/std`: `packages/std/CHANGELOG.md`

   Changelogs follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) for **npm consumers** of
   that package only. There is no root changelog.

   - **Include:** published API/behavior changes, breaking changes, deprecations, and user-visible
     fixes or docs shipped in that package's tarball.
   - **Omit:** monorepo tooling (CI, gate, release scripts), ADRs, contributor docs, internal plan
     implementation names, and refactors with no published API or behavior impact. Do not add a note
     when omitting.
   - **Per release:** use at most one heading per type, in order: `Added`, `Changed`, `Deprecated`,
     `Removed`, `Fixed`, `Security`. Skip empty types. Use past tense; do not repeat the section
     name in every bullet ("Added X" under `### Added`).

2. Cut a release (this promotes `Unreleased`, bumps npm version in the package
   `package.json`, runs release checks, commits, and creates a package-scoped tag):

```bash
pnpm --filter @prodkit/op run release:patch
pnpm --filter @prodkit/std run release:patch
```

*Note:* `release:minor` and `release:major` will be added when needed.

If `Unreleased` is empty, the cut script writes a minimal
"No user-facing changes" note for the new version.
The changelog/version updates must be committed before tag creation because
release validation runs against the tagged commit.

3. Push commit and tag:

```bash
pnpm --filter @prodkit/op run release:push
pnpm --filter @prodkit/std run release:push
```

4. The workflow (for tags like `op-v0.1.70` or `std-v0.1.1`) then:

   - validates the tag is the latest package-scoped tag on `main`
   - installs with `pnpm install --frozen-lockfile`
   - publishes with npm trusted publishing (OIDC) and provenance
     (`pnpm --filter @prodkit/<package> publish --provenance --access public --no-git-checks`)

## Release Failure Recovery

If a release tag is pushed but the release workflow fails (for example,
changelog/version mismatch), use a forward-fix workflow:

1. Leave the failed tag as-is (do not rewrite tag history by default).
2. Add the missing changelog note under the package changelog under `## [Unreleased]`.
3. Cut the next patch release:

```bash
pnpm --filter @prodkit/op run release:patch
```

4. Push commit and tag:

```bash
pnpm --filter @prodkit/op run release:push
```

The failed run remains red in history, but the next tag should publish cleanly.

Only use tag deletion/force-retagging when absolutely necessary and explicitly
approved.

## Manual Publish Fallback

`@prodkit/op`:

```bash
pnpm --filter @prodkit/op run release:prepare
pnpm --filter @prodkit/op publish --access public --provenance --no-git-checks
```

`@prodkit/std` (after version + changelog updates):

```bash
pnpm --filter @prodkit/std run release:prepare
pnpm --filter @prodkit/std publish --access public --provenance --no-git-checks
```
