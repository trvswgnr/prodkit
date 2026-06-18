# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Improve `require-yield-star` lint throughput by deferring checker setup until type-aware
  detection is needed and caching repeated detector lookups.
- Keep checker-backed detection aligned with the current lint source instead of reusing stale
  TypeScript programs after edits.
- Reuse checker programs for unchanged on-disk files instead of rebuilding a full TypeScript
  program for every linted file.
- Recognize aliased `@prodkit/op` factory names when scoping Op generator bodies, and avoid
  autofixing shadowed local `Op.<builder>` lookalikes when checker information is available.
- Scope `require-yield-star` to generator bodies passed directly to `Op(...)`, avoiding false
  positives in plain generators.

## [0.1.2] - 2026-06-18

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
