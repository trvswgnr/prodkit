# FAQ

Straight answers to the questions that show up first when someone new encounters `@prodkit/op`.

## Why another effect library? Why not Effect?

Effect is a full application runtime: fibers, services, streams, observability, and a large
ecosystem. When that is what you want, use Effect.

`@prodkit/op` targets a narrower job: typed async **operations** with explicit failure,
cancellation, cleanup, retry, and timeout in ordinary TypeScript generator syntax. You wrap risky
workflows; you do not adopt a platform. See [comparison.md](comparison.md) for the boundary.

Pick `@prodkit/op` when production services need predictable execution semantics around the async
code you already write. Pick Effect when the platform is the product.

## Why depend on `better-result`?

`@prodkit/op` uses `better-result` for the result boundary: `Result`, `TaggedError`,
`UnhandledException`, and typed error inference. `.run()` returns the same `Result` types your app
already imports from `better-result`.

Split imports keep ownership clear: `better-result` owns result primitives and their release
surface; `@prodkit/op` owns the async runtime (combinators, policies, lifecycle, cancellation).
`better-result` stays a required peer so your app installs one copy and TypeScript sees one type
identity. See [better-result.md](better-result.md).

Re-exporting `better-result` from `@prodkit/op` would blur semver and encourage duplicate or
mismatched copies. The peer plus split import is intentional.

## Who maintains this?

`@prodkit/op` is led by a single maintainer today. The public API is intentionally bounded so the
runtime stays understandable: a team can read the source, extend through documented subpaths, fork,
or maintain a private line without inheriting platform-scale complexity.

Contributions are welcome through the monorepo
[`CONTRIBUTING.md`](https://github.com/trvswgnr/prodkit/blob/main/CONTRIBUTING.md). Security
reports go through
[`SECURITY.md`](https://github.com/trvswgnr/prodkit/blob/main/SECURITY.md).

## Is it production ready?

`@prodkit/op` is in beta and strictly follows SemVer from `0.2.0` onward. What runs on every merge:

- **Property-based law tests** exercise combinator and monad contracts with fast-check (`tests/property/`).
- **Cross-runtime smoke** runs consumer installs on Bun, Deno, edge (Miniflare), and current
  non-EOL Node LTS lines in CI.
- **Docs cannot drift:** `docs:check` fails the gate on broken links across shipped consumer docs.
- **Public API snapshot:** `api:manifest:check` compares exports to a frozen manifest so beta
  surface changes are explicit.
- **Runtime invariants:** `invariants:check` keeps contributor invariant docs aligned with enforced
  behavior.
- **Consumer pack smoke** installs `@prodkit/op` from an `npm pack` tarball in an isolated workspace
  before publish.
- **Hardened publish pipeline:** package-scoped tags trigger trusted publishing with npm provenance.

`@prodkit/op` is ESM-only, runtime-agnostic at the public API, and ships with no runtime npm
dependencies beyond the `better-result` peer you install explicitly.
