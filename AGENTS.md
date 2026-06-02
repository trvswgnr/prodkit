## Evergreen Maintenance Protocol

- Treat this file as living memory: update it whenever durable user preferences or agent-specific workflow signals become clear.
- Capture only durable signals; do not add task-specific notes, temporary debugging details, or one-off preferences.
- Before adding a bullet, check whether `docs/CONTEXT.md`, `CONTRIBUTING.md`, or package `DESIGN.md` already cover it. If yes, link there instead of duplicating.
- If a new signal contradicts an existing bullet, replace the old bullet instead of adding both.
- Keep bullets short and decision-relevant so future agents can scan this file quickly.
- Review this file before major edits and after finishing major tasks to keep memory fresh.

## Doc map

Read these before guessing repo structure or conventions:

- Vocabulary and which doc to open: `docs/CONTEXT.md`
- Setup, gate, release, and monorepo layout: `CONTRIBUTING.md`
- `@prodkit/op` runtime invariants: `packages/op/DESIGN.md`
- Decision history: `docs/adr/README.md`
- Execution module map: `docs/contributor/runtime-architecture.md`

## Agent environment

- Run `pnpm install` outside the sandbox (request full permissions); it hangs or fails in the default sandbox.
- Run `pnpm run gate` outside the sandbox by default; the pack smoke step needs network and a temp `pnpm install`.
- If bare `pnpm` resolves to an incompatible user-level shim, put the active Node 24.x bin directory first on `PATH` so nested gate commands use pnpm 11.5.0.

## User preferences

- Prefers principal-level technical reasoning with clear tradeoffs and long-term system impact.
- Prefers agreeing on API/design direction before implementation when requirements are ambiguous.
- Prefers `.run(...args)` to stay args-only; cancellation/config should compose fluently (for example via `.with(Policy.cancel(...))`) rather than be passed to `run`.
- Prefers user-facing docs and comments to emphasize outcomes and usage over internal implementation details.
- Requires ASCII-only in repo text (comments, docs, changelogs): no Unicode symbols or typographic punctuation (arrows, em dashes, etc.).
- Forbids `--` as a markdown list-item separator between a term and description; write full sentences or use a colon after the term instead (shell passthrough `--` in commands is fine).
- Prefers file relocations to be done with move operations first (for example `mv`) followed by minimal targeted edits, not full-file rewrites.
- Prefers hard-cutover transitions, not gradual deprecations and migrations (alpha stage; intentional breaking changes are acceptable).
- Prefers normalization only when inputs have an obvious safe interpretation; invalid inputs should surface at run time as `Err(UnhandledException)` with the validation error as `cause`.

## Workflow defaults

- Run `pnpm run gate` after completing work, before considering anything "done".
- Keep `packages/op/CHANGELOG.md` `Unreleased` updated for published API impact; omit monorepo/CI/ADR/internal-only work with no consumer-facing API change.
- Prefer to handle version/tag/publish release steps personally unless explicitly delegated.
- When drafting commit messages, prefer why-focused messages grounded in the staged/unstaged diff, with the simplest fitting body shape (none, one sentence, or bullets).
- Do not move GitHub issues to `Done` without explicit approval first.
- For issue hierarchies, prefer real GitHub parent/sub-issue links over markdown-only checklists.
- For GitHub issue triage, use `needs refinement` (not title prefixes) when maintainer judgment is required before agent work.
- Do not add turbo `examples#smoke` to gate; it races workspace `dist/` with the pack harness rebuild (see `CONTRIBUTING.md` for gate shape).
