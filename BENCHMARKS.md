# Benchmarks

Performance work for `@prodkit/op` uses three layers:

1. **CodSpeed** (CI): automated runtime regression detection on every push and pull request.
2. **compressed-size-action** (CI): automated bundle-size comparison on pull requests.
3. **`profile.ts`** (local): V8 CPU/heap profiling and overhead breakdown when you need to investigate a regression.

## CodSpeed runtime benchmarks

Vitest bench scenarios live in [`benchmarks/op/codspeed.bench.ts`](benchmarks/op/codspeed.bench.ts). Shared scenario semantics live in [`benchmarks/op/scenarios.ts`](benchmarks/op/scenarios.ts).

CI runs two CodSpeed jobs from [`.github/workflows/codspeed.yml`](.github/workflows/codspeed.yml):

- **simulation**: instruction counting via Valgrind. Deterministic. Best for sync hot paths (generator dispatch, instruction stepping).
- **walltime**: controlled wall-clock with statistical change detection. Best for async overhead (microtasks, Promise resolution, event loop turns).

CodSpeed comments on pull requests with regression data and flame graphs (simulation mode). Track history on the [CodSpeed dashboard](https://codspeed.io/trvswgnr/prodkit).

### Local run

Build `@prodkit/op` first, then run benches with plain Vitest (CodSpeed instrumentation activates only in CI or with the CodSpeed CLI):

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/op-benchmarks run codspeed:bench
```

Or from repo root:

```bash
pnpm run bench
```

### Setup (maintainers, one-time)

1. Sign up at [codspeed.io](https://codspeed.io) and import `trvswgnr/prodkit`.
2. Install the CodSpeed GitHub App on the repository.
3. Trigger the CodSpeed workflow on `main` (`workflow_dispatch` or push). CodSpeed backtests to establish baseline data; subsequent PRs get regression comments automatically.

## Bundle size

The CI `bundle-size` job uses [`preactjs/compressed-size-action`](https://github.com/preactjs/compressed-size-action) to build the PR branch and target branch, minify the `@prodkit/op` ESM entry with esbuild, and compare gzip sizes. It comments on pull requests automatically.

Measurement matches the old harness: `tsdown` build, then esbuild minify of `dist/index.mjs` (`pnpm run build:size`).

Fork PRs cannot receive comments (GitHub permission model); the job still prints the comparison to stdout.

## Local profiling

When CodSpeed flags a regression, use `profile.ts` for deep investigation. CodSpeed flame graphs can lose async stack traces; V8 `--cpu-prof` handles async code fine.

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/op-benchmarks run profile
pnpm --filter @prodkit/op-benchmarks run profile:cpu -- --scenario=compose.yieldChain
pnpm --filter @prodkit/op-benchmarks run profile:heap -- --scenario=compose.yieldChain
```

See [`benchmarks/op/README.md`](benchmarks/op/README.md) for scenario tables and CLI flags.

## Scenarios measured

Runtime (CodSpeed):

- Single-op overhead (`Op.of(...).run()` vs raw async resolve)
- Parallel aggregation (`Op.all` vs `Promise.all`, 8 children)
- First success (`Op.any` vs hand-rolled first success)
- First settler (`Op.race` vs hand-rolled first settler)
- Retry overhead (`withRetry` vs hand-rolled retry loop, 3 attempts)
- Timeout overhead (`withTimeout` vs `Promise.race` + `setTimeout`)
- Sequential composition (native async chain, async fn chain, Op yield* chain, Op flat loop, Op sequential runs, raw sync yield*)

Bundle size (compressed-size-action):

- `@prodkit/op` ESM entry minified + gzip bytes

## Contributor guidance

- Trust CodSpeed PR comments and the dashboard for regression signals, not local wall-clock numbers.
- Use `profile.ts` to isolate overhead sources after a CodSpeed regression.
- Keep scenario semantics aligned between `codspeed.bench.ts`, `scenarios.ts`, and `profile.ts` when adding or changing workloads.
