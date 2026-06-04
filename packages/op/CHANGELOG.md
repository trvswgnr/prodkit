# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- No entries yet.

## [0.1.80] - 2026-06-04

### Changed

- Declare `sideEffects: false` in `package.json` so bundlers can tree-shake unused exports.

## [0.1.79] - 2026-06-03

### Changed

- Reclassified execution invariants as contributor documentation (`docs/contributor/op-invariants.md`);
  the former `packages/op/DESIGN.md` no longer ships in the npm tarball. Consumer guides under
  `packages/op/` no longer link to monorepo ADRs or other contributor-only docs.

### Fixed

- Deep fluent and policy chains now execute stack-safely instead of resolving to
  `Err(UnhandledException)` or throwing from `.run()` when valid compositions get large.
- Interleaved fluent transforms and push-through policies (for example
  `.with(Policy.retry(...)).map(...)`) now bind in linear time instead of quadratic time at
  `.run()` / `yield*`, with unchanged push-through semantics.
- Stacking push-through policies on an op whose bound plan is already a deep unary chain (for
  example after invoking a parameterized op built with many `.map(...)` layers) no longer re-walks
  that entry depth once per policy at bind time.
- Corrected bundle size figures in the published performance docs; the main entry is now measured
  as a bundled graph (`better-result` externalized), with a consumer subpath upper bound
  (`di`, `policy`, `hkt`).

### Removed

- `@prodkit/op/internal` no longer exports `AbortSignalLike`, `unsafeCoerce`, `NEVER`, `hasBrand`, or
  `sleepWithSignal`.

## [0.1.78] - 2026-06-01

### Changed

- No user-facing changes in this release.

## [0.1.77] - 2026-06-01

### Changed

- `DI.provide` now takes a tuple of bindings (`DI.provide(op, [a, b])`) instead of a spread of
  separate binding arguments. Internal validation type `ValidProvideEntries` is renamed to
  `ValidProvideBindings` to match the public parameter name.

### Removed

- Removed unused internal helpers and exports: `hasTag`, `hasOwn`, `Meta`, `Identity`,
  `DeepIdentity`, `RequireOne`, `assertPositiveInteger`, module exports for `retryPlan`,
  `timeoutPlan`, and `cancelPlan`, and `OP_POLICY` / `OP_POLICY_INPUT` symbols from
  `@prodkit/op/policy` types.

### Fixed

- `.tap`, `.tapErr`, and `.recover` no longer drive returned ops implicitly. Callback return
  values are ignored for `tap` and `tapErr`, while `recover` treats the handler return as fallback
  data. Use `flatMap` or `yield*` for explicit operation sequencing.
- `Policy.timeout` now rejects timer values above the platform `setTimeout` maximum at run
  time instead of scheduling an immediate timeout.
- `Policy.retry(null)` now fails at run time with `UnhandledException` instead of falling back
  to the default retry policy.
- `Policy.cancel` now settles when the bound signal aborts while inner `Op.try` work
  ignores the signal, instead of hanging until that work completes (aligned with
  `Policy.timeout` fan-out behavior for non-cooperative children).
- `Op.race` and `Op.any` no longer hang when a losing branch ignores abort: fan-out children
  now run through the interrupting drive path so aborted losers unwind even when they never
  observe the abort signal.
- `Op.all` and `DI.provide` now run nested child work through the interrupting drive path and
  drain in-flight fan-out/provision suspend work after outer `Policy.timeout` abort, so `Op.defer`
  cleanup still runs when inner `Op.try` ignores the abort signal.
- DI dependency slots now match by token class at runtime, not by diagnostic `key` string. Two
  token classes with the same `DI.Dependency("...")` label are distinct slots; providing one no
  longer satisfies `DI.inject` on the other or rejects the second binding as a duplicate.

## [0.1.76] - 2026-05-31

### Added

- Added `Policy` namespace export on `@prodkit/op/policy` with `retry`, `timeout`, `cancel`,
  `release`, and `define`.
- Added `Policy` type alias and nested type helpers (`Policy.Input`, `Policy.Source`, `Policy.Type`,
  `Policy.BuiltIn`) on `@prodkit/op/policy` for custom policy authors.
- README custom policy checklist linking `@prodkit/op/hkt` and `Policy.define`.
- Restored `@prodkit/op/internal` for extension and maintainer helpers (`Blocking`, `withBlocking`,
  `CustomInstruction`, metadata inference types, `AbortSignalLike`, `unsafeCoerce`, `NEVER`, and
  related symbols).
- Added compositional HKT helpers on `@prodkit/op/hkt`: `HKT.Compose`, `HKT.Flip`, `HKT.Fix1`,
  `HKT.Fix2`, and `HKT.Fix12`.
- Added `HKT.Applied` for value-level witnesses of an already-applied constructor (use with
  `Fix12<F, ...>`, not `Fix12<Applied<F, Args>, ...>`).
- Added `DI.MissingDependencyError` and `DI.DuplicateDependencyError` on `@prodkit/op/di` for
  inspecting binding failures on `UnhandledException.cause` after `.run()`.

### Changed

- Renamed internal DI requirement types for clarity: `ProvidedDeps` to `RemainingRequiredDeps`,
  `InvalidUseReq` to `ExcessProvidedDeps`, and `ValidUseEntries` to `ValidProvideEntries`.
- Split DI provision naming between singleton and lazy shapes: `ScopedResolveFn` to `LazyResolveFn`,
  `Binding` to `SingletonBinding`, and singleton/lazy-specific internal helpers. Provision entries
  are branded with `DI_SINGLETON_BINDING` and `DI_LAZY_BINDING` instead of string `_tag` fields.
- Renamed `DependencyReqInstruction` to `InjectInstruction`, `InferMetaReqs` to
  `RequiredDepsOfMeta`, and public `InferReqs` to `RequiredDeps`.
- Consolidated `@prodkit/op/hkt` under a single `HKT` export (interface, namespace, and
  `HKT.PARAMS` / `HKT.TYPE` symbol constants). Use `HKT.Param`, `HKT.Apply`, and the compositional
  helpers on the namespace instead of former top-level exports.
- Renamed retry policy `attempts` to `retries`. The field now counts post-failure retries only
  (`retries: 0` runs once; default `retries: 2` keeps the previous three-run budget). Custom
  `delay(retry, cause)` callbacks now receive a 0-based retry index (`0` for the first retry after
  initial failure); `Delay.exponential` uses `baseMs * 2 ** retry`.
- Policy HKT encoding now uses `[HKT.TYPE]: Op<...>` instead of tuple `[HKT_RESULT]`;
  `OpPolicyType` is the identity transform, and widening policies extend `HKT` directly.
- Invalid `Policy.timeout(timeoutMs)` values (negative or non-finite) now fail at run time as
  `Err(UnhandledException)` instead of being clamped to zero.
- Retry and timeout policy plans return `Err(UnhandledException)` explicitly for configuration
  validation failures; `Delay.exponential` options are validated once per run, not on every retry
  attempt. Non-integer `retries` surfaces `TypeError` as `cause`; negative `retries` use
  `RangeError`.
- Renamed retry delay type `RetryDelay` to `Delay` so it shares a name with the `Delay` helper
  namespace; `.with(...)` result typing now uses `HKT.Apply` directly instead of `OpPolicyResult`.

### Removed

- Removed direct dependency implementation instances from `DI.provide` entries; use
  `DI.singleton(dependency, value)` or `DI.scoped(dependency, resolve)` instead of subclassing a
  token and passing `new MyImpl()`.
- Removed top-level `retry`, `timeout`, `cancel`, `release`, and `define` exports from
  `@prodkit/op/policy`; use `Policy.retry`, `Policy.timeout`, `Policy.cancel`, `Policy.release`, and
  `Policy.define` instead.
- Removed `HKT` re-exports from `@prodkit/op/policy`; import from `@prodkit/op/hkt` only.
- Removed top-level `HKTArg`, `HKT_ARGS`, `HKT_TYPE`, `Apply`, `Compose`, `Flip`, `Fix1`,
  `Fix2`, and `Fix12` exports from `@prodkit/op/hkt`; use the `HKT` namespace instead.
- Removed `OpPolicyArg`, `OpPolicyArgs`, `RetryPolicyType`, `CancelPolicyType`, and
  `ReleasePolicyType` from `@prodkit/op/policy`; identity policies use `OpPolicyType`, and only
  `TimeoutPolicyType` remains as a distinct HKT for error widening.
- Removed `OpPolicy`, `OpPolicyInput`, `OpPolicySource`, `OpPolicyType`, `OpPolicyResult`,
  `ApplyOpPolicy`, and `BuiltInPolicy` from `@prodkit/op/policy` public exports; use the `Policy`
  type alias and nested helpers instead.
- Removed `definePolicy` from `@prodkit/op/policy`; use `define` only.
- Removed extension-only exports from the main `@prodkit/op` entry (`Blocking`, `withBlocking`,
  `BlockingOp`, `EmptyMeta`, `CustomInstruction`, `MergeMeta`, `InferOpMeta`, `InferInstructionMeta`,
  `Meta`); import them from `@prodkit/op/internal` instead. `EnterContext`, `ExitContext`, and
  `OpLifecycleHook` remain on the main entry for lifecycle typing.
- Removed unused `InferOk`, `InferErr`, and `InferArgs` type exports from `@prodkit/op/di`; use `Op`
  conditional types or `better-result`'s `InferErr` for result typing. `RequiredDeps` remains for
  dependency metadata.

## [0.1.75] - 2026-05-31

### Added

- Documented `@prodkit/op/policy`, `@prodkit/op/hkt`, and subpath export surfaces in README;
  refreshed `PERFORMANCE.md` snapshot.
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
  bindings (moved from `@prodkit/std/di`).

### Removed

- Removed the `@prodkit/op/internal` export.

## [0.1.73] - 2026-05-30

### Changed

- Replaced the public retry policy shape with `attempts`, `when`, and `delay`, moved built-in
  delay helpers under `Delay`, and removed the root `exponentialBackoff` export.

## [0.1.72] - 2026-05-29

### Changed

- Sync `Op.of(value)` now uses a lightweight runtime shell: `.run()` resolves directly and
  `yield*` skips `makePlanOp`; fluent transforms still upgrade through the normal plan path.

## [0.1.71] - 2026-05-28

### Changed

- Replaced the internal fluent `OpHooks` rebuild path with plan-backed composition, keeping the
  public `Op` API stable while moving policy push-through into structural plan nodes.
- `Op.recover` now accepts only a type-predicate function (for example `MyError.is`); passing a
  `TaggedError` class or a plain boolean predicate is no longer supported.

### Fixed

- `Op.all`, `Op.allSettled`, `Op.any`, and `Op.race` now merge child operation metadata so
  requirements declared only in combinator branches flow to parent `yield*` sites and provisioning.

## [0.1.70] - 2026-05-27

### Changed

- Normalized composed operation metadata to display without per-key `readonly` modifiers; `Op`'s `M`
  parameter still accepts writable object literals via `Meta`.

### Added

- Documented `better-result` peer dependency range, semver expectations, and which symbols callers
  import from `better-result` versus `@prodkit/op` in the package README.

## [0.1.69] - 2026-05-26

### Added

- Added the generic `Op<T, E, A, M>` metadata slot, branded `EmptyMeta`, metadata inference helpers,
  and custom-instruction metadata inference for extension packages.
- Added `@prodkit/op/internal` entry for low-level helpers shared with extension packages
  (for example `@prodkit/std`).
- Exported `AbortSignalLike`, `functionHasTruthyBrand`, and `NEVER` via `@prodkit/op/internal`
  for runtime-agnostic extension code.
- Added the generic `Blocking<T>` metadata brand for extension packages, exported
  `withBlocking(..., key)` / `BlockingOp` for marking operations that are not ready to run, and kept
  `IsRunnable<M>` and `SetBlockingMeta` on `@prodkit/op/internal` for extension inference.

### Changed

- Removed the phantom `_E` type parameter from `CustomInstruction`; typed generator errors are inferred
  only from yielded `Err` values and nested ops. Extension metadata remains on `M`.
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

- Documented runtime compatibility for Bun, Deno, and Cloudflare Workers-like (Miniflare)
  environments in package smoke coverage.

## [0.1.67] - 2026-05-14

## [0.1.66] - 2026-05-14

## [0.1.65] - 2026-05-14

### Added

- Added `Op.sleep(ms)` as a cancellation-aware core operation for timer
  delays and polling loops, with non-finite durations surfaced as run-time
  `UnhandledException` failures.

### Changed

- Unified operation internals behind `core/ops` + `OpInterface` by removing the
  previous nullary/arity split while preserving the public fluent API surface.
- Expanded async contracts across core/runtime/policy paths from `Promise` to
  `PromiseLike` and hardened thenable detection so the library remains
  runtime-agnostic while preserving existing cancellation semantics.
- Extended `Op.run` to accept runtime arguments (`Op.run(op, ...args)`) so the
  factory helper matches instance `run(...args)` behavior for parameterized ops.
- Expanded and standardized JSDoc across `Op` static and instance methods.
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

### Fixed

- Fixed `withTimeout` structured-cancellation semantics so timeout now waits for
  aborted branch unwind/finalizers before returning `Err(TimeoutError)`, while
  keeping timeout result precedence on the timeout path.
- Fixed lifecycle exit-context arg propagation so `ExitContext.args` now reflects
  runtime inputs for deferred/finalizer cleanup in both direct arity runs and
  nested parameterized `yield*` composition.

## [0.1.62] - 2026-05-11

## [0.1.61] - 2026-05-11

## [0.1.58] - 2026-05-09

### Changed

- Changed `Op.try` `onError` mapper handling to pure normalization
  (`E | Promise<E>`). Returned `Op`/generator values are no longer executed;
  they are now treated as the `Err` value directly.

### Fixed

- Fixed `Op.try` to await async `onError` mappers before emitting `Err`, so
  rejection mapping no longer leaks a raw `Promise` into the error channel and
  downstream tagged-error matching remains type- and runtime-consistent.

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

- Added an `enter` lifecycle hook (`.on("enter", ...)`) so runs can attach
  setup side effects at run start without threading setup through call sites;
  enter/exit contexts now also expose runtime `args` for arity ops.
- Added `DESIGN.md` documenting execution invariants (cleanup ordering, error
  precedence, and combinator chain-order guarantees).

### Changed

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

## [0.1.53] - 2026-05-02

## [0.1.50] - 2026-05-02

## [0.1.49] - 2026-05-02

## [0.1.1 - 0.1.48] - 2026-05-02

### Added

- Established the core `Op` model with typed `Result` outcomes, generator-first
  composition, and fluent operation chaining.
- Added policy primitives and composition APIs, including retry, timeout,
  signal-aware execution, and core combinators (`all`, `allSettled`, `any`,
  `race`).
- Added lifecycle and cleanup capabilities across operation runs, including
  release/finalizer hooks and generator-scoped deferred cleanup.

### Changed

- Evolved API naming and ergonomics over time (for example `Op.pure` -> `Op.of`,
  `suspend` -> `Op.try`, and lifecycle hook API updates) to improve clarity and
  consistency.
- Standardized outcomes on `better-result` and aligned public re-exports around
  explicit API surface decisions.
- Reworked internal architecture to reduce wiring drift, centralize fluent op
  construction, and improve maintainability of core execution paths.
- Strengthened type safety and typing clarity, including tighter inference
  behavior and explicit handling of unavoidable TypeScript limitations.

### Fixed

- Improved cleanup and cancellation reliability across error, timeout, and abort
  paths, including generator finalization behavior.
- Tightened combinator and policy behavior in edge cases (listener teardown,
  retry timing, and composed operation semantics).



