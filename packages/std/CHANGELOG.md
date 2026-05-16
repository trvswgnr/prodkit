# Changelog

## Unreleased

- Renamed DI terminology to dependency-first language (`DI.Dependency`, `DI.singleton`, `MissingDependencyError`, `RequireDependency`, `Binding`, `DependencyReq`, `InferDependencyNeeds`) and aligned internal op helpers around `createDependencyOp` / `buildDependencyOp`.
- Removed the local abort-signal stub; `.withSignal` uses `AbortSignalLike` from `@prodkit/op/internal`.
- Replaced local `unsafeCoerce` usage with `@prodkit/op/internal` so helpers stay centralized.
- Changed `@prodkit/op` to a peer dependency so consumers install a single compatible `@prodkit/op` alongside `@prodkit/std`.
- Added the initial `@prodkit/std` package with `@prodkit/std/di` helpers for yieldable dependency tokens and dependency-aware `Op` wrappers.
- Added DI regression coverage for defaulted and rest-parameter dependency operations.
- Changed DI provisioning to use `DI.Dependency(...)`, `DI.singleton(Dependency, value)` binding values, direct dependency implementation instances in `.use(...)`, and variadic `.use(...)` calls.
- Added `DI.scoped(Dependency, resolve)` for scoped (per-run) dependency resolution with in-run memoization.
- Changed DI operation construction to avoid inspecting generator `Function.length`.
