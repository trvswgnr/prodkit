## Evergreen Maintenance Protocol

- Treat this file as living memory: update it whenever durable user preferences or stable workspace facts become clear.
- Capture only durable signals; do not add task-specific notes, temporary debugging details, or one-off preferences.
- If a new signal contradicts an existing bullet, replace the old bullet instead of adding both.
- Keep bullets short and decision-relevant so future agents can scan this file quickly.
- Review this file before major edits and after finishing major tasks to keep memory fresh.

## Learned User Preferences

- Prefers principal-level technical reasoning with clear tradeoffs and long-term system impact.
- Prefers agreeing on API/design direction before implementation when requirements are ambiguous.
- Prefers `.run(...args)` to stay args-only; cancellation/config should compose fluently (for example via `.with(Policy.cancel(...))`) rather than be passed to `run`.
- Prefers user-facing docs and comments to emphasize outcomes and usage over internal implementation details.
- Requires ASCII-only in repo text (comments, docs, changelogs): no Unicode symbols or typographic punctuation (arrows, em dashes, etc.).
- Forbids `--` as a markdown list-item separator between a term and description; write full sentences or use a colon after the term instead (shell passthrough `--` in commands is fine).
- When requesting commit message drafts, prefers why-focused messages grounded in the actual staged/unstaged diff.
- Prefers commit message drafts to use the simplest fitting body shape (none, one sentence, or bullets) rather than forcing multiple bullets.
- Prefers file relocations to be done with move operations first (for example `mv`) followed by minimal targeted edits, not full-file rewrites.
- Wants `pnpm run gate` run after completing work, before considering anything "done".
- Does not want GitHub issues moved to `Done` without explicit approval first.
- For issue hierarchies, prefers real GitHub parent/sub-issue links over markdown-only checklists.
- Wants issue-work flows to keep `packages/op/CHANGELOG.md` `Unreleased` updated, but prefers to handle version/tag/publish release steps personally unless explicitly delegated.
- Prefers hard-cutover transitions, not gradual deprecations and migrations (this project is in alpha, so intentional breaking changes are acceptable)
- Prefers normalization only when inputs have an obvious safe interpretation; invalid inputs should surface at run time as `Err(UnhandledException)` with the validation error as `cause`.
- For GitHub issue triage, use `needs refinement` (not title prefixes) when maintainer judgment is required before agent work.

## Learned Workspace Facts

- `pnpm install` must be run outside the sandbox (request full permissions / non-sandbox); it hangs or fails reliably in the default sandbox.
- Run `pnpm run gate` outside the sandbox by default; the final `@prodkit/tools` pack smoke step needs network and a temp `pnpm install`, which reliably times out or hangs in restricted/no-network sandboxes.
- Node 24.x is Active LTS (current LTS line; Node 22.x is maintenance LTS only). Contributors need Node >=24.14.0. Do not suggest Node 22 or 20 for this workspace.
- Contributors should use `pnpm@11` locally (CI/release stays pinned to `11.5.0`). Global install via `npm install -g pnpm@11.5.0` is fine; corepack is optional.
- If bare `pnpm` resolves to an incompatible user-level shim, put the active Node 24.x bin directory first on PATH so nested gate commands use pnpm 11.5.0.
- Shared workspace dev-tool versions (`typescript`, `vitest`, `oxfmt`, `oxlint`, `tsdown`, `@vitest/coverage-v8`) are declared once under `catalog:` in `pnpm-workspace.yaml`; workspace packages (including `packages/*`, repo root, `examples`, `tools`, `benchmarks`) reference them as `"catalog:"`. Pack/runtime smoke harnesses also use `pnpm` so those manifests stay valid outside the main workspace checkout.
- npm publishing is configured with GitHub Actions trusted publishing (OIDC + provenance), not long-lived `NPM_TOKEN` auth.
- The library is designed to be runtime-agnostic, not Node-specific in behavior.
- CI verifies the runtime-agnostic claim with a separate Bun, Deno, and Miniflare runtime smoke matrix.
- The project is currently alpha-stage with no production users, so intentional breaking changes are acceptable.
- Workspace taxonomy: `packages/*` (publishable), `packages/shared` (`@prodkit/shared`, private workspace types/config), `examples` (`@prodkit/examples`, consumer smoke workspace), `benchmarks` (`@prodkit/benchmarks`, performance harnesses), `tools` (`@prodkit/tools`, maintainer scripts), and `apps/*` reserved for runnable product/demo apps.
- Op-native modules (runtime-agnostic, no third-party deps beyond `better-result`) ship as `@prodkit/op` subpath exports (for example `@prodkit/op/di`, `@prodkit/op/policy`, `@prodkit/op/internal` for extension helpers); do not put them in `@prodkit/std` or separate npm packages. The main `@prodkit/op` entry is for application consumers; extension metadata (`Blocking`, `withBlocking`, `CustomInstruction`, etc.) lives on `@prodkit/op/internal`.
- `@prodkit/std` is a general runtime-agnostic utility layer (typed helpers for platform gaps, prefer-native, zero runtime deps, tree-shakeable subpaths such as `@prodkit/std/array`); it is not the home for op-specific features. DI lives on `@prodkit/op/di`.
- `@prodkit/op/hkt` owns the reusable HKT encoding (`HKT` interface/namespace with `HKT.PARAMS`,
  `HKT.TYPE`, `HKT.Param`, `HKT.Apply`, `HKT.Compose`, `HKT.Flip`, `HKT.Fix1`, `HKT.Fix2`, and
  `HKT.Fix12`); policy consumes it internally and does not re-export it from `@prodkit/op/policy`.
- `@prodkit/op/policy` owns retry, timeout, cancel, release, Delay, retry policy types, runtime policy wrappers, and the open `Policy.define(...)` protocol; core plan internals should not grow retry/timeout/cancel-specific methods. `Policy.release((value) => ...)` keeps success-value contextual typing through the contravariant `Policy.Input` phantom, not a release-specific `.with(...)` overload.
- Root `pnpm run gate` (`package.json`): turbo `build`, `typecheck`, `test`, `lint`, `fmt:check` (upstream `build` before downstream `typecheck`), then `@prodkit/tools` `adr:check`, `changelog:api:check`, `design:check`, and `smoke` (`tools/run-examples-smoke.ts` pack harness: temp workspace with repo `catalog:`, `pnpm install`, then `pnpm --filter @prodkit/examples run smoke`). Do not add turbo `examples#smoke` to gate; it races workspace `dist/` with the pack harness rebuild.
- ADRs (`docs/adr/`) record why (evergreen body, no issue checklists on `accepted` records); package `DESIGN.md` records invariants. Changed decisions get a new numbered ADR; mark the old one `superseded` and link forward. See `docs/adr/README.md`.
- Documentation roles: `docs/CONTEXT.md` (vocabulary and which doc to open); `packages/op/README.md` (consumer hub + core API); `packages/op/docs/` (subpath and advanced guides, ships on npm); `docs/contributor/runtime-architecture.md` (execution module map); `CONTRIBUTING.md` (setup, gate, release). Root `README.md` has a documentation map table.
- Package `CHANGELOG.md` files are consumer-facing (Keep a Changelog); omit monorepo/CI/ADR/internal-only work with no published API impact. No root changelog.
- GitHub repository canonical path is `trvswgnr/prodkit` (renamed from `trvswgnr/op`).
