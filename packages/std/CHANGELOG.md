# Changelog

## Unreleased

- Added the initial `@prodkit/std` package with `@prodkit/std/di` helpers for yieldable context tokens and context-aware `Op` wrappers.
- Changed DI provisioning to use `Ctx.Service(...)`, `Service.of(value)` provider values, and variadic `.use(...)` calls.
