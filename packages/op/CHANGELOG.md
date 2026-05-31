# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Restored `@prodkit/op/internal` for extension and maintainer helpers (`Blocking`, `withBlocking`,
  `CustomInstruction`, metadata inference types, `AbortSignalLike`, `unsafeCoerce`, `NEVER`, and
  related symbols).

### Changed

- Renamed policy-related test suites to `Policy.retry` / `Policy.timeout` vocabulary and documented
  pre-ADR 0009 policy method names in superseded ADRs 0002 and 0007.

### Removed

- Removed extension-only exports from the main `@prodkit/op` entry (`Blocking`, `withBlocking`,
  `BlockingOp`, `EmptyMeta`, `CustomInstruction`, `MergeMeta`, `InferOpMeta`, `InferInstructionMeta`,
  `Meta`); import them from `@prodkit/op/internal` instead. `EnterContext`, `ExitContext`, and
  `OpLifecycleHook` remain on the main entry for lifecycle typing.
- Removed unused `InferOk`, `InferErr`, and `InferArgs` type exports from `@prodkit/op/di`; use `Op`
  conditional types or `better-result`'s `InferErr` for result typing. `InferReqs` remains for
  dependency metadata.

## [0.1.75] - 2026-05-31

### Added

- Documented `@prodkit/op/policy`, `@prodkit/op/hkt`, and subpath export surfaces in README;
  refreshed `PERFORMANCE.md` snapshot; ADR index now includes `status`; contributor docs and
  `changelog:api:check` cover policy and HKT entrypoints.

- Added `@prodkit/op/policy` with `retry`, `timeout`, `cancel`, `release`, `Delay`, and retry
  policy types for policy composition through `.with(Policy.*)`.
- Added `@prodkit/op/hkt` with reusable `HKT`, `HKTArg`, and `Apply` helpers for open type-level
  transforms.
- Added the open `Policy.define(...)` protocol so library authors can build custom `.with(...)`
  policies without adding core overloads.

### Changed

- Reduced per-`.with(...)` allocation overhead for the open policy protocol by sharing
  `PolicySourceImpl` and `DelegatingPlanRewriter` prototype methods, hoisting built-in rewriter
  construction to policy factory time, and assigning `OP_POLICY` directly in `definePolicy`.
- Replaced `.withRetry(...)`, `.withTimeout(...)`, `.withSignal(...)`, and `.withRelease(...)`
  with `.with(Policy.retry(...))`, `.with(Policy.timeout(...))`, `.with(Policy.cancel(...))`,
  and `.with(Policy.release(...))`.
- Moved policy runtime wrappers and retry policy helpers out of core internals and under the
  policy module.
- Renamed `Policy.signal` to `Policy.cancel` and `SignalPolicyAttachment` to
  `CancelPolicyAttachment`.

### Removed

- Removed root `Delay` and retry policy type exports from `@prodkit/op`; import them from
  `@prodkit/op/policy` instead.

## [0.1.74] - 2026-05-30

### Added

- Added `@prodkit/op/di` subpath export with dependency tokens, inject, provide, and scoped/singleton
  bindings (moved from `@prodkit/std/di`). Consumer examples live under `examples/op/di/`.

### Removed

- Removed the `@prodkit/op/internal` export.

## [0.1.73] - 2026-05-30

### Changed

- Replaced the public retry policy shape with `attempts`, `when`, and `delay`, moved built-in
  delay helpers under `Delay`, and removed the root `exponentialBackoff` export.
- Replaced the wall-clock `bench.ts` harness with CodSpeed (simulation + walltime Vitest benches)
  and `compressed-size-action` for bundle-size PR comments. Added a shared comparison matrix
  (`comparison-matrix.ts`), local `compare` report harness, `overhead.*.ratio` CodSpeed benches,
  and restored `performance:sync` to publish native-vs-Op slowdown ratios in `PERFORMANCE.md`.
  CodSpeed walltime benches track Op timings and overhead ratios only; native baselines stay in
  `compare.ts` for the public snapshot table.
- Consolidated benchmark workspace layout to match `examples/`: shared `@prodkit/benchmarks` package
  at `benchmarks/` with Op-specific harness code under `benchmarks/op/`.
- Benchmark harness JSON reports and V8 profiles now write under `benchmarks/op/.artifacts/`.
- Renamed comparison scenario `singleOp` to `singleValue` so matrix keys match workload names.
- Refactored the comparison matrix to column-driven scenarios (`implementations` keyed by library
  id). Comparison reports now expose `vsBaseline` ratios per competitor column; `compare` and
  `performance:sync` render absolute ops/sec and vs-native tables dynamically from
  `IMPLEMENTATION_COLUMNS`.
- Added an `effect` competitor column to the comparison matrix with matching scenario runners for
  the public `PERFORMANCE.md` snapshot. CodSpeed benches remain Op-only.
- Added `compare --pair=<left>,<right>` for direct library head-to-head output (for example
  `--pair=op,effect`) using absolute ops/sec from the same benchmark run.
- Removed dead hook-era internals after the plan AST cutover: unused `*CoreOp` builders,
  `DefaultHooks`, and orphan `with*Op` policy wrappers. Fluent methods now share one
  `fluentMethodsForContext` factory between `makePlanOp` and the sync-value hot path.
- Folded `makeCoreOp` into `core/fluent.ts` and dropped the `policies.ts` re-export shim;
  retry policy types and helpers now import from `core/retry-policy.ts` directly.

## [0.1.72] - 2026-05-29

### Changed

- Sync `Op.of(value)` now uses a lightweight runtime shell: `.run()` resolves directly and
  `yield*` skips `makePlanOp`; fluent transforms still upgrade through the normal plan path.

### Added

- Added sequential-compose profile harness in `@prodkit/op-benchmarks`: shared `harness.ts` and
  `scenarios.ts`, `tinybench` breakdown statistics, `--steps=` / `--report=profile.json`, sync
  reference table split, CPU/heap artifact detection, and Vitest scenario smoke tests.

### Fixed

- Stabilized the `Op.race` first-settler property test by driving the oracle through the same
  `Op.try` branch path as the combinator and advancing fake timers for deterministic settlement.

## [0.1.71] - 2026-05-28

### Changed

- Moved `@prodkit/op` tests out of `src/` into a tiered `tests/` layout (unit, integration,
  property, types, hygiene, support) so implementation and test-only code stay separated.
- Replaced the internal fluent `OpHooks` rebuild path with plan-backed composition, keeping the
  public `Op` API stable while moving policy push-through into structural plan nodes.
- Expanded the Op benchmark harness with `Op.any`, `Op.race`, and sequential compose scenarios;
  `PERFORMANCE.md` now snapshots all seven runtime pairs.
- `Op.recover` now accepts only a type-predicate function (for example `MyError.is`); passing a
  `TaggedError` class or a plain boolean predicate is no longer supported.
- CI gate now fails when monitored public export entrypoints change without a matching
  `CHANGELOG.md` update under unreleased heading.

### Fixed

- `Op.all`, `Op.allSettled`, `Op.any`, and `Op.race` now merge child operation metadata so
  requirements declared only in combinator branches flow to parent `yield*` sites and provisioning.

### Added

- Property-based regression tests for `Op.any`, `Op.race`, retry delays, and retry
  policy attempt-count invariants.
- Performance snapshot in [`PERFORMANCE.md`](PERFORMANCE.md) (all harness scenarios, ops/sec,
  slowdown ratios, and bundle size), refreshable via
  `pnpm --filter @prodkit/tools run performance:sync -- --write`.
- Published Op benchmark baseline guidance in [`benchmarks/op/README.md`](../../benchmarks/op/README.md),
  with CI `op-benchmarks` artifacts carrying machine-readable `report.json` overhead ratios.

## [0.1.70] - 2026-05-27

### Changed

- Normalized composed operation metadata to display without per-key `readonly` modifiers; `Op`'s `M` parameter still accepts writable object literals via {@link Meta}.

### Added

- Documented `better-result` peer dependency range, semver expectations, and which symbols callers
  import from `better-result` versus `@prodkit/op` in the package README.

### Added

- Documented core/fluent structural decisions in `docs/adr/` (nullary core vs lifted arity,
  `OpHooks` push-through rebuild, timeout rebuild hook asymmetry, three cleanup channels,
  combinator loser finalization waits, `UnhandledException` runtime channel, args-only `.run()`).

## [0.1.69] - 2026-05-26

### Added

- Added the generic `Op<T, E, A, M>` metadata slot, branded `EmptyMeta`, metadata inference helpers,
  and custom-instruction metadata inference for extension packages.
- Added `@prodkit/op/internal` entry for low-level helpers shared with extension packages
  (for example `@prodkit/std`).
- Exported `AbortSignalLike`, `functionHasTruthyBrand`, and `NEVER` via `@prodkit/op/internal`
  for runtime-agnostic extension code.
- Added regression coverage for generator-built operation callback sequencing without relying on
  function arity reflection.
- Added the generic `Blocking<T>` metadata brand for extension packages, exported
  `withBlocking(..., key)` / `BlockingOp` for marking operations that are not ready to run, and kept
  `IsRunnable<M>` and `SetBlockingMeta` on `@prodkit/op/internal` for extension inference.

### Changed

- Removed the phantom `_E` type parameter from `CustomInstruction`; typed generator errors are inferred
  only from yielded `Err` values and nested ops. Extension metadata remains on `M`.
- Consolidated consumer examples into `examples/` (`@prodkit/examples`); consumer smoke now
  validates packed installs for both `@prodkit/op` and `@prodkit/std`.
- Flattened maintainer scripts workspace from `tools/op` to `tools/` and renamed it to
  `@prodkit/tools` (was `@prodkit/op-scripts`).
- `sleepWithSignal(ms, signal)` now types `signal` as `AbortSignalLike` (structurally compatible with
  real `AbortSignal` implementations).
- Changed fluent callback sequencing to drive only bound nullary ops, so returned generator-built
  op factories are treated as plain values unless they are explicitly invoked.
- Preserved or merged operation metadata through fluent combinators so extension metadata survives
  `map`, `mapErr`, policies, lifecycle hooks, `flatMap`, `tap`, `tapErr`, and `recover`.
- Replaced DI-specific metadata merge with generic key-level `MergeMeta` that unions values at
  shared keys, so composed ops keep one metadata object (for example
  `{ deps: A | B }`) instead of a union of per-op metadata objects.
- Fixed `InferOpMeta` inference for ops with runtime arguments; it now matches any args tuple instead
  of requiring `readonly unknown[]`.
- `.run()` and `Op.run(...)` are available by default and blocked when operation metadata
  carries any unsatisfied `Blocking<T>` value or the op was wrapped with `withBlocking(..., key)`.

## [0.1.68] - 2026-05-15

### Added

- Added a comparison page covering tradeoffs against Effect, neverthrow, `fp-ts`,
  native `Promise`, and `ResultAsync`.
- Added CI-published Vitest coverage artifacts for `@prodkit/op` so correctness
  evidence is easier to audit from workflow runs.
- Added packed-package runtime smoke coverage for Bun, Deno, and a Cloudflare Workers-like
  Miniflare environment, with CI matrix coverage for each runtime.
- Added dependency signature auditing to CI and release-runner network auditing
  for supply-chain monitoring.

## [0.1.67] - 2026-05-14

### Fixed

- Built the package before release changelog validation so fresh GitHub Actions
  runners can resolve the workspace package entrypoint.

## [0.1.66] - 2026-05-14

### Changed

- Hardened workspace installs by disabling npm lifecycle scripts by default.
- Pinned GitHub Actions workflow dependencies to full commit SHAs.
- Hardened the npm release workflow by removing pnpm cache restore from the
  publish path.
- Hardened GitHub Actions checkout steps so workflow tokens are not persisted
  after checkout.

## [0.1.65] - 2026-05-14

### Added

- Added `Op.sleep(ms)` as a cancellation-aware core operation for timer
  delays and polling loops, with non-finite durations surfaced as run-time
  `UnhandledException` failures.
- Added regression coverage for parameterized generator ops to make sure
  defaulted and rest parameters receive explicit runtime args via `.run(...args)`.

### Changed

- Unified operation internals behind `core/ops` + `OpInterface` by removing the
  previous nullary/arity split while preserving the public fluent API surface.
- Expanded async contracts across core/runtime/policy paths from `Promise` to
  `PromiseLike` and hardened thenable detection so the library remains
  runtime-agnostic while preserving existing cancellation semantics.
- Extended `Op.run` to accept runtime arguments (`Op.run(op, ...args)`) so the
  factory helper matches instance `run(...args)` behavior for parameterized ops.
- Expanded and standardized JSDoc/examples across `Op` static and instance
  methods, with type-level coverage to prevent documentation drift.
- Limited direct `yield* op` composition to nullary ops so parameterized ops
  must be invoked before composition.

### Fixed

- Reworked the polling example to use `Op.sleep` instead of recovering an
  internal retry sentinel, so external cancellation no longer becomes a
  successful stale value.
- Registered the polling example interval cleanup with `Op.defer` so it runs
  when the example exits through success, failure, timeout, or cancellation.
- Clarified lifecycle docs that `ExitContext.result` is the pre-finalizer
  settlement result and that effectful cleanup belongs in registered finalizers,
  not yielded generator `finally` blocks.
- Corrected contributor and package README smoke-check commands to point at the
  `@prodkit/op-scripts` workspace that owns the `examples:smoke:*` scripts.
- Corrected `Op.run` README wording to reflect parameterized
  `Op.run(op, ...args)` support.
- Passed the same unwrapped retry cause to `RetryPolicy.when` and
  `RetryPolicy.delay`, so cause-aware delay functions see the same value as
  retry predicates.
- Hardened Op detection against plain functions with `_tag: "Op"` and made
  nullary op calls return another runnable Op instead of an internal state
  object.
- Removed silent result filtering from bounded `Op.all`/`Op.allSettled` success
  paths so internal scheduler gaps surface as `UnhandledException`.
- Replaced `Promise.prototype.finally` cleanup coupling in signal binding with
  `try/finally`, preventing listener/timer cleanup regressions when callers pass
  non-native thenables.
- Corrected README/operator docs for `Op.try` mapper handling and `mapErr`
  bypass behavior around `UnhandledException`.

## [0.1.64] - 2026-05-12

### Changed

- Clarified docs that `Op.run(op)` is a quick-run helper without a caller-facing
  cancel handle; callers that need external cancellation should compose
  `.withSignal(signal)` before running.

### Fixed

- Corrected `Op.settle` (`settleOp`) typing so the nested `Result` error type
  includes `UnhandledException`, matching `drive()` and avoiding a silent
  `E`-only contract at the type level.

## [0.1.63] - 2026-05-11

### Added

- Added lifecycle regression coverage proving `withTimeout` does not settle
  `run()` until async `withRelease` cleanup and async `.on("exit")` finalizers
  finish.

### Fixed

- Fixed `withTimeout` structured-cancellation semantics so timeout now waits for
  aborted branch unwind/finalizers before returning `Err(TimeoutError)`, while
  keeping timeout result precedence on the timeout path.
- Fixed lifecycle exit-context arg propagation so `ExitContext.args` now reflects
  runtime inputs for deferred/finalizer cleanup in both direct arity runs and
  nested parameterized `yield*` composition.

## [0.1.62] - 2026-05-11

### Changed

- Updated repository references from `trvswgnr/op` to `trvswgnr/prodkit` after the monorepo rename.

## [0.1.61] - 2026-05-11

### Changed

- Renamed the monorepo quality script from `pnpm run check` to `pnpm run gate`.

## [0.1.58] - 2026-05-09

### Changed

- Changed `Op.try` `onError` mapper handling to pure normalization
  (`E | Promise<E>`). Returned `Op`/generator values are no longer executed;
  they are now treated as the `Err` value directly.
- Migrated the project to a pnpm + Turborepo monorepo layout
  (`packages/op`, `examples/op`, `benchmarks/op`, `tools/op`) so
  installs, task orchestration, and CI checks run from one workspace graph with
  a single lockfile.
- Adapted the existing tag-based release process to the monorepo structure by
  updating CI/release workflows and release automation to run through pnpm
  filters while keeping the current non-Changesets publish flow.
- Updated contributor and user-facing docs to reflect the new workspace paths
  and pnpm-based commands.

### Fixed

- Fixed `Op.try` to await async `onError` mappers before emitting `Err`, so
  rejection mapping no longer leaks a raw `Promise` into the error channel and
  downstream tagged-error matching remains type- and runtime-consistent.
- Fixed consumer smoke validation to run in an isolated temporary examples
  workspace, preventing package-install smoke checks from mutating or clobbering
  workspace-linked dependencies.

## [0.1.57] - 2026-05-07

### Changed

- Unified operation typing around the exported `Op` contract across builders,
  combinators, policies, and runtime internals, so public helper inference now
  consistently reflects the same type surface users compose against.

## [0.1.55] - 2026-05-06

### Fixed

- Fixed `yield*` interop for generic helpers returning `Op(function* () {})` in raw TypeScript execution by ensuring callable op wrappers expose an iterator path, so nullary helpers now compose without surfacing `Err(UnhandledException)`.
- Fixed `Op.any` tuple inference so infallible branches collapse the error channel to `never` instead of exposing an impossible `ErrorGroup`.
- Fixed `Op.all` type inference to stop injecting `UnhandledException` into declared error unions when no operation can produce it.

## [0.1.54] - 2026-05-06

### Added

- Added `src/test-utils.ts` to centralize shared integration-test helpers
  (`deferred`, abort-listener tracking, async timing helpers, and invalid
  concurrency fixtures) so new test files can reuse one source of truth.
- Added an `enter` lifecycle hook (`.on("enter", ...)`) so runs can attach
  setup side effects at run start without threading setup through call sites;
  enter/exit contexts now also expose runtime `args` for arity ops, with
  documented behavior and integration/type coverage.
- Added focused `core` runtime unit coverage for `drive` internals (signal
  handoff, instruction validation, finalizer LIFO ordering, and cleanup-fault
  precedence), plus direct tests for internal helper/type-guard behavior.
- Added `DESIGN.md` documenting execution invariants (cleanup ordering, error
  precedence, and combinator chain-order guarantees) with direct links to
  representative runtime paths and tests to reduce semantic drift risk.
- Added a dedicated `benchmarks/` harness with baseline comparisons against
  latest `main` (default) or latest npm release, covering runtime overhead
  scenarios plus minified/gzip bundle-size deltas.

### Changed

- Extracted default nullary lifecycle hook wiring into a shared helper and
  reused it across builders, combinators, policies, and core nullary operators
  to remove repetitive hook plumbing without changing runtime behavior.
- Fixed `tap`, `tapErr`, and `recover` so callbacks that return `Op(function* () {})`
  are now executed instead of being treated as plain values, closing a runtime
  type-soundness hole where failures could be silently dropped or function objects
  could leak as successful results.
- Documented the cooperative cancellation contract in `README.md`, including
  explicit runtime guarantees, caller responsibilities, and a composed
  `Op.all(...).withTimeout(...).withSignal(...)` wiring example.
- Locked `Op.any`/`Op.race` loser semantics so aborted branches now finish
  cleanup/finalizers before `run()` returns, while preserving first-settler
  result precedence to keep outcome behavior stable.
- Added inline concurrency-contract comments for combinator drivers and policy
  signal/timeout helpers so contributors can reason about abort propagation,
  cleanup timing, and settle precedence without rediscovering edge cases.
- Clarified contributor testing governance with an explicit two-tier strategy in
  `CONTRIBUTING.md`, including unit vs integration scope boundaries and a
  no-duplication decision rule for placing assertions.
- Added contributor benchmark guidance in `CONTRIBUTING.md` and a dedicated
  `benchmarks/README.md` playbook, while keeping README benchmark docs minimal.
- Consolidated compile-time API contracts into a dedicated `src/types.test.ts`
  file and removed scattered `expectTypeOf` assertions from runtime behavior
  tests so type regressions can be audited in one place.
- Strengthened algebraic correctness checks by replacing fixed-case monad law
  assertions with property-based tests and adding randomized `Result` algebra
  coverage for `map` and `andThen` composition laws.
- Simplified nullary operator policy wiring to derive retry/timeout/signal behavior
  from `inner`/`rebuild` config in `makeNullaryOp`, reducing per-operator boilerplate
  while preserving push-through vs wrap-self semantics (including timeout widening
  edge cases for `mapErr`, `tapErr`, `recover`, and `onExit`).
- Collapsed arity-level operator wrappers into a generic lifting path so fluent
  `map`/`mapErr`/`flatMap`/`tap`/`tapErr`/`recover` on parameterized ops reuse
  shared policy plumbing while preserving timeout and lifecycle behavior.

## [0.1.53] - 2026-05-02

### Changed

- Hardened release cut automation so changelog promotion is formatted before
  validation checks run.
- Kept release behavior consistent when `Unreleased` is empty by generating a
  minimal release note automatically.
- Consolidated release scripts so cuts promote changelog entries, bump version,
  and tag in one flow.
- Aligned CONTRIBUTING release guidance with the automated cut path.
- Captured and validated intermediate release-candidate behavior that
  previously failed changelog/version gating.

## [0.1.50] - 2026-05-02

### Added

- Added a release guard that requires a changelog heading matching the current
  package version before publish steps run.

## [0.1.49] - 2026-05-02

### Added

- Added the first project changelog and captured the pre-changelog release
  history to establish a stable baseline for future release notes.

## [0.1.1 - 0.1.48] - 2026-05-02

### Added

- Established the core `Op` model with typed `Result` outcomes, generator-first
  composition, and fluent operation chaining.
- Added policy primitives and composition APIs, including retry, timeout,
  signal-aware execution, and core combinators (`all`, `allSettled`, `any`,
  `race`).
- Added lifecycle and cleanup capabilities across operation runs, including
  release/finalizer hooks and generator-scoped deferred cleanup.
- Expanded examples and smoke coverage for realistic consumer install paths.

### Changed

- Evolved API naming and ergonomics over time (for example `Op.pure` -> `Op.of`,
  `suspend` -> `Op.try`, and lifecycle hook API updates) to improve clarity and
  consistency.
- Standardized outcomes on `better-result` and aligned public re-exports around
  explicit API surface decisions.
- Reworked internal architecture to reduce wiring drift, centralize fluent op
  construction, and improve maintainability of core execution paths.
- Strengthened type safety and typing clarity, including cast policy guidance,
  tighter inference behavior, and explicit handling of unavoidable TypeScript
  limitations.
- Hardened release, CI, and smoke workflows around trusted publishing and
  consumer-style verification.

### Fixed

- Improved cleanup and cancellation reliability across error, timeout, and abort
  paths, including generator finalization behavior.
- Tightened combinator and policy behavior in edge cases (listener teardown,
  retry timing, and composed operation semantics).
- Improved examples and parsing validation in places where earlier behavior
  could produce weaker diagnostics or drift from production expectations.

