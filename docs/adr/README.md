# Architectural decision records

ADRs capture **why** the codebase is shaped the way it is. They live at repo root because this
is a monorepo, but each record should name the package(s) it applies to so readers know where to
look in the tree.

Contributor invariant docs (for example [`docs/contributor/op-invariants.md`](../contributor/op-invariants.md))
document what must stay true; ADRs document why a shape was chosen.

## Format

- Files live here as `NNNN-short-slug.md` with sequential numbering (`0001`, `0002`, ...).
- Each ADR starts with YAML frontmatter, then an `#` heading that **must match** `title`, then a
  short opening paragraph (context).
- Prefer this section order when it fits: **Decision**, **Why not** (or **Problem**), **Considered
  options**, **Consequences**. Skip sections that would repeat `op-invariants.md` invariants without new
  rationale.
- Keep the body **evergreen**: describe the decision and trade-offs, not open issue checklists or
  migration status. Track delivery in GitHub issues; do not add `Implementation` sections to
  `accepted` ADRs. Full style rules: [`docs/CONTEXT.md`](../CONTEXT.md#evergreen-writing).

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

Track implementation work in GitHub issues, not in the ADR body. Do not add ad hoc plan docs under
`docs/` for issue checklists.

## Updating and superseding

Treat each ADR as a historical record of a decision at a point in time. Git history is the audit
trail; the file should stay readable without relying on diffs alone.

**When the decision changes**, add a new sequentially numbered ADR with the new choice and
rationale. Do not delete or gut the old file. Set the old ADR's `status` to `superseded` (or
`deprecated` when the direction is abandoned without a single replacement). Add a short note at
the top of the old ADR linking to the replacement(s). The new ADR should name what it supersedes
when that context helps readers.

**While `status: proposed`**, the body may evolve until the team accepts it. After acceptance,
avoid rewriting the `Decision` section to mean something different. Prefer a follow-on ADR, or a
clear in-body note (as in ADR 0007) when the same number must record a revised recommendation
before acceptance.

**Safe edits to accepted or superseded ADRs** include cross-links, typos, and clarifications that do
not change what was decided. Move behavioral contracts into `docs/contributor/op-invariants.md` (or similar) rather
than growing ADRs into invariant checklists or issue trackers.

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
| [0007](0007-op-execution-plan-ast.md) | accepted | `@prodkit/op` | Op execution plan AST vs push-through rebuild hooks |
| [0008](0008-op-subpath-exports.md) | accepted | `@prodkit/op`, `@prodkit/std` | Op-native modules ship as @prodkit/op subpath exports |
| [0009](0009-policy-with-attachment.md) | accepted | `@prodkit/op` | Policy attaches via .with(Policy.*) |
| [0010](0010-di-token-class-identity.md) | accepted | `@prodkit/op` | DI dependency tokens match by class reference at runtime |
| [0011](0011-fluent-callbacks-do-not-sequence-returned-ops.md) | accepted | `@prodkit/op` | Fluent callbacks do not sequence returned ops |
| [0012](0012-op-type-alias-on-main-entry.md) | accepted | `@prodkit/op` | Op type alias stays on main entry for declaration emit |
| [0013](0013-combinator-plan-nodes.md) | accepted | `@prodkit/op` | Combinator concurrent composition as plan nodes |
| [0014](0014-strict-semver-from-0-2-0-beta.md) | accepted | `@prodkit/op` | Strict SemVer from 0.2.0 beta |
| [0015](0015-better-result-peer-split-imports.md) | accepted | `@prodkit/op` | better-result stays a peer with split imports |

<!-- adr-index:end -->
