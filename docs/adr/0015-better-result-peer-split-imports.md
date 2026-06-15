---
status: accepted
title: better-result stays a peer with split imports
packages:
  - "@prodkit/op"
---

# better-result stays a peer with split imports

`@prodkit/op` builds on [`better-result`](https://github.com/dmmulroy/better-result) for `Result`,
`TaggedError`, and `UnhandledException`. Consumers routinely import both packages. The beta
readiness question was whether to re-export core `better-result` symbols from `@prodkit/op` for a
single import path.

## Decision

- `better-result` remains a **required peer dependency** (`^2.9.0` aligned with op releases).
- **Split imports**: consumers import result primitives from `better-result` and operation APIs
  from `@prodkit/op` (main entry or subpaths such as `@prodkit/op/di`).
- `@prodkit/op` **does not re-export** `Result`, `TaggedError`, `UnhandledException`, or other
  `better-result` symbols from any public export map entry.

This matches the existing `package.json` `peerDependencies` and `exports` layout (see ADR 0008
for subpath placement; the main entry still does not re-export peers).

Package internals use the private `packages/op/src/result.ts` facade to keep the allowed
`better-result` surface explicit. That internal boundary does not change the consumer split-import
contract.

## Why not re-export from `@prodkit/op`

Re-exports blur ownership: type identity, semver, and breaking changes for result types would
appear to come from `@prodkit/op` while they are defined and released by `better-result`. A single
import surface also encourages duplicate copies or mismatched versions when peers are hoisted
incorrectly. Split imports keep the dependency graph honest and documentation unambiguous.

## Considered options

**Re-export `Result`, `TaggedError`, and `UnhandledException` from the main entry.** Rejected:
adds confusion about which package owns changes and duplicates the peer contract.

**Fold `better-result` into `@prodkit/op` as a runtime dependency (not a peer).** Rejected:
risks multiple `Result` types in one app and works against the zero-extra-runtime-deps goal for op
subpaths.

## Consequences

- User-facing docs and examples show imports from both packages where both are needed.
- Compatibility work in CI validates peer alignment and interop, not a merged export surface.
- New public symbols that are pure `better-result` types stay out of `@prodkit/op` export maps.
