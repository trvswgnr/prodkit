# Changelog

## Unreleased

- Added the initial `@prodkit/std` package with `@prodkit/std/di` helpers for yieldable context tokens and context-aware `Op` wrappers.
- Added DI regression coverage for defaulted and rest-parameter context operations.
- Changed DI provisioning to use `Ctx.Service(...)`, `Service.of(value)` provider values, and variadic `.use(...)` calls.
- Changed DI operation construction to avoid inspecting generator `Function.length`.
