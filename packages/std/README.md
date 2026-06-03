# @prodkit/std

**Reserved.** This package will ship tree-shakeable, runtime-agnostic utilities (for example
`@prodkit/std/array`) with no `@prodkit/op` dependency. Nothing is published from `src/` yet.

Op-specific features (DI, policy, HKT, future op-native policies such as a circuit breaker) live on
`@prodkit/op` subpath exports when they are runtime-agnostic and depend only on op and
`better-result`. Platform-specific or integration-SDK code (OpenTelemetry, Node CLI adapters) ships
as separate `@prodkit/*` packages. See [`@prodkit/op` README](https://github.com/trvswgnr/prodkit/tree/main/packages/op#readme),
[`docs/CONTEXT.md`](https://github.com/trvswgnr/prodkit/blob/main/docs/CONTEXT.md#where-new-code-lives),
and [ADR 0008](https://github.com/trvswgnr/prodkit/blob/main/docs/adr/0008-op-subpath-exports.md)
(monorepo docs; not shipped in the npm tarball).

The [`examples/std/`](https://github.com/trvswgnr/prodkit/blob/main/examples/std/) directory is
reserved for future consumer samples.
