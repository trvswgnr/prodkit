# Monorepo Migration Design

## Context

`@prodkit/op` is currently a single-package repository with adjacent package-like folders (`examples`, `benchmarks`, `scripts`). The project needs to add new packages soon while keeping the core library dependency surface minimal and runtime-agnostic.

The current structure already hints at monorepo concerns (multiple lockfiles, per-folder install steps in CI), but there is no first-class workspace model or automated dependency-boundary enforcement.

## Goals

- Move to a true monorepo layout that scales for multiple packages without repeated repo churn.
- Keep `@prodkit/op` behavior and public API unchanged during migration.
- Enforce package boundaries so optional dependencies do not leak into core.
- Support hybrid release workflows: independent by default, coordinated when needed.
- Preserve current quality bar (`npm run check`) and trusted publishing guarantees.

## Non-Goals

- No semantic/runtime changes to core operation behavior in this effort.
- No immediate addition of multiple new publishable packages in this migration alone.
- No gradual dual-layout compatibility period. This is a hard-cutover transition.

## Target Repository Topology

Use purpose-based top-level directories:

- `packages/*`: publishable libraries
- `apps/*`: runnable artifacts
- `tools/*`: internal automation

Initial cutover shape:

```text
packages/
  op/                    # current @prodkit/op package moved here
apps/
  examples/              # consumer smoke/typecheck app
  benchmarks/            # benchmark harness app
tools/
  scripts/               # release/check helper scripts
```

Naming rule for future growth:

- `packages/<package-name>`
- `apps/<artifact-name>`
- `tools/<capability-name>`

Avoid `core-*` prefixes in folder names. They tend to encode ownership assumptions that become inaccurate as sibling packages grow.

## Workspace and Tooling Direction

### Package Manager

Adopt `pnpm` workspaces as the monorepo baseline for install/link ergonomics and predictable workspace behavior at scale.

### Workspace Definition

Root workspace config should include:

- `packages/*`
- `apps/*`
- `tools/*`

### Task Running

Keep existing quality/build/test tools initially (TypeScript, Vitest, oxfmt, oxlint, tsdown). Migration risk is reduced by changing repo topology first and avoiding toolchain churn in the same change set.

## Package Boundary Guardrails

Boundary policy:

1. `packages/op` stays runtime-agnostic and minimal.
2. Optional integration dependencies live in separate packages only.
3. CI fails on forbidden dependency edge violations.

Guardrail implementation should be automated (workspace-level checks), not manual review guidance.

Additional policy guardrail:

- Runtime packages should avoid Node-only dependencies unless explicitly documented as Node-targeted packages.

## Release Model

Use Changesets to support hybrid release behavior:

- Default: independent package versioning.
- Optional coordinated release: grouped bumps for related packages when API movement needs lockstep communication.

Publishing requirements to preserve:

- Trusted publishing with OIDC + provenance.
- Release validation from `main` lineage and latest tag semantics.

## CI/CD Design

### Pull Requests

- Install workspace dependencies once.
- Run changed-package checks (plus dependency-graph validity checks).
- Keep fast feedback for incremental work.

### Main and Release Paths

- Run full workspace quality gate.
- Publish only changed packages by default, or explicit coordinated set for grouped releases.

## Migration Phases

### Phase 1: Structural Cutover

- Introduce workspace files/config at root.
- Move current root package into `packages/op`.
- Move `examples` -> `apps/examples`.
- Move `benchmarks` -> `apps/benchmarks`.
- Move `scripts` -> `tools/scripts`.
- Update path references in npm scripts and docs.

Exit criteria:

- Local installs complete successfully via workspace manager.
- Existing check/test/build commands function from new paths.

### Phase 2: CI Migration

- Update CI install/cache steps for workspace lockfile layout.
- Replace per-folder install calls with workspace-aware commands.
- Preserve current quality gate semantics.

Exit criteria:

- CI passes on PR and `main` with no regression in quality checks.

### Phase 3: Release Migration

- Introduce Changesets and release workflow integration.
- Validate independent and coordinated release scenarios.
- Keep changelog and versioning conventions aligned with repo policy.

Exit criteria:

- Dry-run and real release path both succeed under trusted publishing model.

### Phase 4: Boundary Enforcement

- Add dependency-edge policy checks for core package isolation.
- Document package-type expectations (runtime-agnostic vs integration-specific).

Exit criteria:

- A deliberate boundary violation fails CI.

## Risks and Mitigations

### Risk: Release Disruption During Tooling Transition

Mitigation:

- Stage release migration after structural and CI stabilization.
- Run release dry-runs before first post-migration publish.

### Risk: Hidden Path Coupling in Scripts/Docs

Mitigation:

- Perform full scripted path audit.
- Run `npm run check` after each phase and before merge.

### Risk: Dependency Creep into Core Package

Mitigation:

- Enforce dependency boundaries in CI rather than relying on conventions.

## Validation Strategy

Minimum validation gates for migration completion:

1. `npm run check` passes from repository root.
2. Consumer smoke flow still validates package consumption from packed artifact.
3. CI and release workflows execute successfully with workspace layout.
4. Dependency-boundary checks fail on intentional violation test.

## Rollback Strategy

If migration introduces release-blocking instability:

- Pause release tagging.
- Revert migration branch as one unit.
- Reapply in smaller phase slices with validated checkpoints.

No force-push or history rewrite is required for rollback.

## Decisions Captured

- Monorepo layout will be purpose-based (`packages`, `apps`, `tools`), not `core-*` prefixed.
- Hard cutover transition is preferred over gradual dual-path migration.
- Hybrid releases (independent default + coordinated option) are required.
- Boundary enforcement for core-package purity is mandatory and automated.
