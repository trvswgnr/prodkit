# Architectural decision records

ADRs capture **why** the codebase is shaped the way it is. They live at repo root because this
is a monorepo, but each record should name the package(s) it applies to so readers know where to
look in the tree.

Package-local invariant docs (for example [`packages/op/DESIGN.md`](../../packages/op/DESIGN.md))
document what must stay true; ADRs document why a shape was chosen.

## Format

- Files live here as `NNNN-short-slug.md` with sequential numbering (`0001`, `0002`, ...).
- Each ADR starts with YAML frontmatter, then an `#` heading that **must match** `title`, then the
  decision statement (context, choice, and reason).
- Optional body sections (`Considered Options`, `Consequences`) are added only when they help a
  future maintainer avoid re-litigating a settled trade-off.

### Frontmatter

Required fields:

```yaml
---
status: accepted # proposed | accepted | deprecated | superseded
title: Short decision title
packages:
  - "@prodkit/op" # one or more workspace package names
---
```

`title` is the canonical name for tooling and index generation. Repeat it as the first H1 in the
body so GitHub and IDE markdown previews render a visible title.

`packages` uses npm names (`@prodkit/op`, `@prodkit/std`, ...). List every package the decision
applies to; use a repo-scoped ADR with multiple entries when a choice spans packages.

### Index

The table below is generated from ADR frontmatter (`status`, `title`, `packages`). After adding or editing an ADR, run:

```bash
pnpm --filter @prodkit/tools run adr:sync
```

`pnpm run gate` runs `adr:check` and fails if the index is stale.

## When to add one

Add an ADR when a decision is hard to reverse, surprising without context, and the result of a
real trade-off. Skip obvious or easily reversed choices.

Track implementation work in GitHub issues; link them from the ADR `Implementation` section. Do
not add ad hoc plan docs under `docs/` for issue checklists.

## Index

<!-- adr-index:start -->

| ADR | Status | Package | Title |
| --- | --- | --- | --- |
| [0001](0001-core-nullary-vs-lifted-arity.md) | accepted | `@prodkit/op` | Core driver uses nullary ops; public API preserves tuple arity |
| [0002](0002-ophooks-rebuild-and-timeout-asymmetry.md) | superseded | `@prodkit/op` | OpHooks push-through rebuild and timeout-specific rebuild hooks |
| [0003](0003-three-cleanup-channels.md) | accepted | `@prodkit/op` | Three cleanup channels stay separate by design |
| [0004](0004-combinators-wait-for-loser-finalization.md) | accepted | `@prodkit/op` | Op.any and Op.race wait for loser finalization before run settles |
| [0005](0005-unhandled-exception-runtime-channel.md) | accepted | `@prodkit/op` | UnhandledException is the non-recoverable runtime error channel |
| [0006](0006-run-args-only-fluent-policy-composition.md) | accepted | `@prodkit/op` | run takes args only; cancellation and policy compose fluently |
| [0007](0007-timeout-widening-at-composition-boundary.md) | accepted | `@prodkit/op` | Op execution plan AST vs push-through rebuild hooks |
| [0008](0008-op-subpath-exports.md) | accepted | `@prodkit/op`, `@prodkit/std` | Op-native modules ship as @prodkit/op subpath exports |
| [0009](0009-policy-with-attachment.md) | accepted | `@prodkit/op` | Policy attaches via .with(Policy.*) |
| [0010](0010-di-token-class-identity.md) | accepted | `@prodkit/op` | DI dependency tokens match by class reference at runtime |
| [0011](0011-fluent-callbacks-do-not-sequence-returned-ops.md) | accepted | `@prodkit/op` | Fluent callbacks do not sequence returned ops |

<!-- adr-index:end -->
