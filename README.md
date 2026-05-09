# prodkit monorepo

This repository hosts the `@prodkit/op` package and supporting workspace apps/scripts.

## canonical package docs

Use [`packages/op/README.md`](packages/op/README.md) as the source of truth for:

- installation
- API reference and semantics
- usage examples
- consumer smoke commands

That README is also the one shipped with the published npm package.

## workspace layout

- `packages/op`: publishable library package (`@prodkit/op`)
- `apps/examples`: consumer-style examples and smoke harness
- `apps/benchmarks`: benchmark harness and baseline tooling
- `tools/scripts`: repo automation scripts (release, checks, helpers)
- `.github/workflows`: CI and release automation

## development

- contributor guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- runtime/design notes: [`packages/op/DESIGN.md`](packages/op/DESIGN.md)
- package changelog: [`packages/op/CHANGELOG.md`](packages/op/CHANGELOG.md)

Primary quality gate:

```bash
pnpm run check
```

## release flow

Release commands live in `packages/op/package.json` scripts and are executed from repo root via pnpm filters.

Typical sequence:

```bash
pnpm --filter @prodkit/op run release:patch
pnpm --filter @prodkit/op run release:push
pnpm --filter @prodkit/op run release:publish
```

## license

[MIT](LICENSE)
