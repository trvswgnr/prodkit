# Examples

Consumer-level runnable samples and smoke checks for published `@prodkit/op` packages. This workspace
(`@prodkit/examples`) installs packages the same way downstream apps do and is copied into isolated
temp workspaces by the pack smoke harness in `@prodkit/tools`.

## Layout

```text
examples/
  support/          shared assert and test helpers for smoke runners
  smoke.ts          root entry: op smoke, then di smoke
  op/               @prodkit/op samples (see op/README.md)
  op/di/            @prodkit/op/di samples (see op/di/README.md)
  std/              reserved for future @prodkit/std samples
```

Each topic folder under `op/` or `op/di/` contains:

- `sample.ts`: readable program exports linked from package docs
- `smoke.ts`: executable assertions run by the smoke suite

## Run locally

From the monorepo root after `pnpm install`:

```bash
pnpm --filter @prodkit/examples run smoke
```

Pack install smoke (builds tarballs, copies this workspace into a temp consumer, runs smoke):

```bash
pnpm --filter @prodkit/tools run examples:smoke:pack
```
