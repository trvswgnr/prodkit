# @prodkit/std

**Reserved.** This package will ship tree-shakeable, runtime-agnostic utilities (for example
`@prodkit/std/array`) with no `@prodkit/op` dependency. Nothing is published from `src/` yet.

Op-specific features (DI, policy, HKT) live on `@prodkit/op` subpath exports; see
[`@prodkit/op` README](https://github.com/trvswgnr/prodkit/tree/main/packages/op#readme) and
[ADR 0008](https://github.com/trvswgnr/prodkit/blob/main/docs/adr/0008-op-subpath-exports.md)
(monorepo ADR; not shipped in the npm tarball).

The [`examples/std/`](https://github.com/trvswgnr/prodkit/blob/main/examples/std/) directory is
reserved for future consumer samples.
