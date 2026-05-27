# Changelog

## Unreleased

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
- Added the initial `@prodkit/std` package with `@prodkit/std/di` helpers for yieldable dependency tokens.
- Added DI regression coverage for defaulted and rest-parameter dependency operations.
- Changed DI provisioning to use `DI.Dependency(...)`, `DI.singleton(Dependency, value)` binding values, direct dependency implementation instances, and variadic provisioning calls.
- Added `DI.scoped(Dependency, resolve)` for scoped (per-run) dependency resolution with in-run memoization.
- Changed DI operation construction to avoid inspecting generator `Function.length`.
- Dependency-aware ops carry `deps: Blocking<...>` until `DI.provide(...)` satisfies all
  deps; `.run()` is unavailable until then. Clearing deps does not clear other
  `Blocking<T>` metadata keys on the same op.
