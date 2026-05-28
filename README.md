# prodkit monorepo

This repository is the `prodkit` monorepo, managed with pnpm workspaces and Turborepo (`turbo`).
It is organized for multiple publishable packages plus dedicated top-level workspaces for apps,
examples, benchmarks, and maintainer tooling.

## canonical package docs

Use each publishable package README under `packages/*/README.md` as the source of truth for that package's installation, API reference, usage examples, and consumer-facing commands:

- [`@prodkit/op`](packages/op/README.md) (published to npm with the package)
- [`@prodkit/std`](packages/std/README.md), including the `@prodkit/std/di` entrypoint

Other workspace roots are maintainer- or CI-oriented: [`examples`](examples/) (`@prodkit/examples`), [`tools`](tools/) (`@prodkit/tools`), and [`benchmarks`](benchmarks/).

## workspace layout

- `packages/*`: publishable library packages
- `apps/*`: runnable product/demo applications
- `examples`: consumer examples and smoke workspace (`@prodkit/examples`)
- `benchmarks/*`: performance benchmark harnesses
- `tools`: maintainer tooling workspace (`@prodkit/tools`)
- `.github/workflows`: CI and release automation

## development

- Node: `>=24.14.0` on the 24.x Active LTS line (current LTS; see [nodejs/Release](https://github.com/nodejs/release)). `.nvmrc` pins `24.14.0`.
- contributor guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- `@prodkit/op` benchmark baselines: [`BENCHMARKS.md`](BENCHMARKS.md)
- `@prodkit/op` runtime/design notes: [`packages/op/DESIGN.md`](packages/op/DESIGN.md)
- architectural decision records: [`docs/adr/`](docs/adr/)
- `@prodkit/op` changelog: [`packages/op/CHANGELOG.md`](packages/op/CHANGELOG.md)
- `@prodkit/std` changelog: [`packages/std/CHANGELOG.md`](packages/std/CHANGELOG.md)

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
