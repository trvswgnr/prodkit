# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `DI.scoped(Dependency, resolve)` now passes the run `AbortSignal` to `resolve` and accepts
  sync or async (`PromiseLike`) results. Resolution skips the factory when the signal is already
  aborted, awaits async factories with DI-native abort handling, and leaves the binding uncached
  when abort wins before settlement.

### Added

- DI regression coverage for scoped resolution under pre-abort, in-flight async abort, post-cache
  abort, and factory throw without env corruption.
- DI interaction tests for runtime nested overlapping `provide`, async scoped factory rejection,
  and parent binding sharing under `Op.all` / `Op.race`.

## [0.1.1] - 2026-05-27

### Changed

- Documented `@prodkit/std` peer dependencies (`@prodkit/op`, `better-result`) and pointed to
  `@prodkit/op` for the shared `better-result` public API coupling notes.
- Documented `@prodkit/std` scope in the package README: DI is the only shipped module today, with tracing and typed env/config called out as likely future directions.
- Renamed DI metadata key from `requirements` to `deps`.
- Metadata keys on composed ops now display without per-key `readonly` modifiers (for example `{ deps: Blocking<...> }`).
- Renamed `DI.require` to `DI.inject` for requesting dependency bindings.
- Changed dependency-aware programs to use plain `Op(...)` from `@prodkit/op` with `yield* DI.inject(Dependency)`.
- Changed dependency provisioning to use `DI.provide(op, ...bindings)`.
- Removed `DI.Op` and `.use(...)`; no dependency-aware wrapper operation path remains.
- Added core metadata inference and propagation so DI requirements flow through plain `Op(...)`, nested `yield* op`, and fluent composition.
- Renamed DI terminology to dependency-first language (`DI.Dependency`, `DI.singleton`, `MissingDependencyError`, `RequireDependency`, `Binding`, `DependencyReq`, `InferDependencyBlocking`).
- Removed the local abort-signal stub; `.withSignal` uses `AbortSignalLike` from `@prodkit/op/internal`.
- Replaced local `unsafeCoerce` usage with `@prodkit/op/internal` so helpers stay centralized.
- Changed `@prodkit/op` to a peer dependency so consumers install a single compatible `@prodkit/op` alongside `@prodkit/std`.
- Added DI regression coverage for defaulted and rest-parameter dependency operations.
- Changed DI provisioning to use `DI.Dependency(...)`, `DI.singleton(Dependency, value)` binding values, direct dependency implementation instances, and variadic provisioning calls.
- Added `DI.scoped(Dependency, resolve)` for scoped (per-run) dependency resolution with in-run memoization.
- Changed DI operation construction to avoid inspecting generator `Function.length`.
- Dependency-aware ops carry `deps: Blocking<...>` until `DI.provide(...)` satisfies all
  deps; `.run()` is unavailable until then. Clearing deps does not clear other
  `Blocking<T>` metadata keys on the same op.

## [0.1.0] - 2026-05-09

### Added

- Added the initial `@prodkit/std` package with `@prodkit/std/di` helpers for yieldable dependency tokens.

