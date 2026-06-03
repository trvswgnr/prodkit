# prodkit monorepo

This repository is the `prodkit` monorepo, managed with pnpm workspaces and Turborepo (`turbo`).
It is organized for multiple publishable packages plus dedicated top-level workspaces for apps,
examples, benchmarks, and maintainer tooling.

## canonical package docs

Use each publishable package README under `packages/*/README.md` as the source of truth for that package's installation, API reference, usage examples, and consumer-facing commands:

- [`@prodkit/op`](packages/op/README.md) (published to npm with the package)
- [`@prodkit/std`](packages/std/README.md) (reserved; runtime-agnostic utilities planned)

Other workspace roots are maintainer- or CI-oriented: [`examples`](examples/) (`@prodkit/examples`, with Op samples under `examples/op/` and DI under `examples/op/di/`), [`tools`](tools/) (`@prodkit/tools`), and [`benchmarks`](benchmarks/) (`@prodkit/benchmarks`).

## documentation map

| Audience | Doc | Purpose |
| --- | --- | --- |
| npm consumers | [`packages/op/README.md`](packages/op/README.md) | Hub, quick start, core API |
| npm consumers | [`packages/op/docs/`](packages/op/docs/README.md) | Comparison, performance, subpaths, lifecycle (ships on npm) |
| contributors | [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, gate, testing, release |
| contributors | [`docs/CONTEXT.md`](docs/CONTEXT.md) | Domain vocabulary and doc roles |
| contributors | [`docs/contributor/op-invariants.md`](docs/contributor/op-invariants.md) | Runtime invariants and enforcement map |
| contributors | [`docs/contributor/runtime-architecture.md`](docs/contributor/runtime-architecture.md) | Module graph and execution flow |
| architects | [`docs/adr/`](docs/adr/) | Why decisions were made |

Changelogs: [`packages/op/CHANGELOG.md`](packages/op/CHANGELOG.md), [`packages/std/CHANGELOG.md`](packages/std/CHANGELOG.md).

## workspace layout

- `packages/`: library packages
- `apps/*`: runnable product/demo applications
- `examples`: consumer examples and smoke workspace (`@prodkit/examples`)
- `benchmarks`: performance benchmark harnesses (`@prodkit/benchmarks`)
- `tools`: maintainer tooling workspace (`@prodkit/tools`)
- `.github/workflows`: CI and release automation

## development

- Node: `>=24.14.0` on the 24.x Active LTS line (current LTS; see [nodejs/Release](https://github.com/nodejs/release)). `.nvmrc` pins `24.14.0`.
- contributor guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)

Primary quality gate:

```bash
pnpm run gate
```

## release flow

Pushing a package-scoped tag (`op-v*`, `std-v*`) triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which publishes the matching
npm package with trusted publishing and provenance. Release helpers live on each publishable
package:

```bash
pnpm --filter @prodkit/op run release:patch
pnpm --filter @prodkit/op run release:push

pnpm --filter @prodkit/std run release:patch
pnpm --filter @prodkit/std run release:push
```

## license

[MIT](LICENSE)
