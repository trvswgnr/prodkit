# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Prefer the smallest overlapping TypeScript expression when linter ranges drift, so plain
  generator success returns such as `return a / b` are not mistaken for ignored Ops.

## [0.1.1] - 2026-06-18

### Fixed

- Match TypeScript nodes for checker-backed Op detection when Oxlint or ESLint ranges differ
  slightly from TypeScript offsets, so wrapped helpers that resolve to Ops are reported.

## [0.1.0] - 2026-06-17

### Added

- Publish the initial ESLint-compatible, Oxlint-loadable `@prodkit/op-lint` plugin package with the
  `require-yield-star` rule scaffold.
- Detect ignored `@prodkit/op` values in `require-yield-star` with TypeScript checker-backed
  identity, including aliases, imports, generic `Op` parameters, properties, and methods returning
  Ops.
- Report returned, yielded, and awaited `@prodkit/op` values in `require-yield-star`, with autofixes
  for direct rewrites to `yield*`.

### Changed

- Keep TypeScript external and require it as a peer dependency for checker-backed linting.
- Overhaul the `@prodkit/op-lint` README around common Op generator mistakes, Oxlint setup, ESLint
  setup, and checker-backed detection limits.

## [0.0.0]

### Added

- Establish the unpublished package baseline for release tooling.

