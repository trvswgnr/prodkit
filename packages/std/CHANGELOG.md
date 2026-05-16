# Changelog

## Unreleased

- Aligned `@prodkit/std` dev tooling with the workspace TypeScript 6 line and adjusted DI compile-time assertions for TS 6 optional-parameter tuple typing.
- Changed `@prodkit/op` to a peer dependency so consumers install a single compatible `@prodkit/op` alongside `@prodkit/std`.
- Added the initial `@prodkit/std` package with `@prodkit/std/di` helpers for yieldable context tokens and context-aware `Op` wrappers.
- Added DI regression coverage for defaulted and rest-parameter context operations.
- Changed DI provisioning to use `Ctx.Service(...)`, `Service.of(value)` provider values, and variadic `.use(...)` calls.
- Changed DI operation construction to avoid inspecting generator `Function.length`.
