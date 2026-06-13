# Performance

`@prodkit/op` is a generator-based runtime with instruction dispatch on every step.
Microbenchmarks show measurable overhead compared with raw `Promise` usage. That is expected.
The library trades a small amount of hot-path cost for typed failures, structured concurrency,
cancellation propagation, and composable retry/timeout policy.

Use these numbers to judge whether that tradeoff fits your workload. Real applications are
usually dominated by I/O, so relative overhead matters less once network or database latency is
in the picture.

The harness in [`benchmarks/op`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op)
uses a shared [`comparison-matrix.ts`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op/comparison-matrix.ts)
for native baselines, `@prodkit/op`, and comparison libraries. Scenario definitions and
contributor commands live in
[`benchmarks/op/README.md`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op/README.md).

## Latest comparison snapshot

<!-- op-performance-snapshot:start -->

Captured on **2026-06-02** at commit [`a02537e`](https://github.com/trvswgnr/prodkit/commit/a02537e10a9d602dd68b5816c0237ef7f0faac6f) (`@prodkit/op@0.1.78`).
Environment: v24.14.1, darwin/arm64.
Versus-native ratios use native ops/sec divided by library ops/sec (values above 1x mean slower than native).
Add library columns by extending `IMPLEMENTATION_COLUMNS` and scenario implementations in `benchmarks/op/comparison-matrix.ts`.

### Runtime overhead

| Scenario | Native baseline | Native baseline ops/sec | @prodkit/op | @prodkit/op ops/sec | @prodkit/op vs native | effect | effect ops/sec | effect vs native |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Single value | `Promise.resolve(x)` | 12,633,980.56 | `Op.of(x).run()` | 2,107,066.48 | 6.00x | `Effect.runPromise(Effect.succeed(x))` | 1,894,085.43 | 6.67x |
| Parallel batch (8 children) | `Promise.all([...])` | 1,517,936.39 | `Op.all([...]).run()` | 92,736.86 | 16.37x | `Effect.all(..., { concurrency: 'unbounded' })` | 25,409.18 | 59.74x |
| First success (8 children) | Hand-rolled first success + abort | 59,294.16 | `Op.any([...]).run()` | 36,640.83 | 1.62x | `Effect.firstSuccessOf([...])` | 611,417.56 | 10.31x faster |
| First settler (8 children) | Hand-rolled first settler + abort | 58,791.56 | `Op.race([...]).run()` | 36,404.52 | 1.61x | `Effect.raceFirst` folded over children | 10,811.1 | 5.44x |
| Retry loop | Hand-rolled try/catch retry | 246,189.68 | `Op.try(...).with(Policy.retry(...)).run()` | 49,936.99 | 4.93x | `Effect.retry(..., { times, schedule })` | 43,617.17 | 5.64x |
| Timeout guard | `Promise.race` + `setTimeout` | 3,445,089.38 | `Op.of(x).with(Policy.timeout(ms)).run()` | 325,134.35 | 10.60x | `Effect.timeout(ms)` | 124,409.93 | 27.69x |
| Sequential compose (6 steps) | `await Promise.resolve` chain | 3,338,312.98 | `yield* Op.of` generator chain | 267,895.18 | 12.46x | `Effect.gen` + `yield* Effect.succeed` chain | 895,001.39 | 3.73x |

### Bundle size

Lower bound: bundled main entry only. Upper bound: bundled import of consumer subpaths
(`@prodkit/op`, `@prodkit/op/di`, `@prodkit/op/policy`, `@prodkit/op/hkt`).
`@prodkit/op/internal` is extension-only and is excluded. `better-result` is external in both cases.

| Metric | Size |
| --- | --- |
| Lower bound (main entry) minified | 13,964 B |
| Lower bound (main entry) minified + gzip | 4,346 B |
| Upper bound (consumer subpaths) minified | 21,894 B |
| Upper bound (consumer subpaths) minified + gzip | 6,702 B |

<!-- op-performance-snapshot:end -->

Microbenchmarks measure hot-path overhead, not application latency under I/O. Prefer slowdown
ratios over raw ops/sec when comparing machines.

## Automated regression detection

**Runtime:** CodSpeed runs on every push to `main` and every pull request
([`.github/workflows/codspeed.yml`](https://github.com/trvswgnr/prodkit/blob/main/.github/workflows/codspeed.yml)).
Simulation mode tracks sync hot paths (`compose.rawSyncYieldStar`). Walltime mode tracks Op absolute timings and `overhead.*.ratio` gap benches (native work runs inside the ratio bench, not as separate dashboard series). CodSpeed comments on pull requests;
track history on the [CodSpeed dashboard](https://codspeed.io/trvswgnr/prodkit).

**Bundle size:** The CI `bundle-size` job uses `compressed-size-action` to compare minified + gzip
size of bundled lower and upper bounds for `@prodkit/op` on pull requests. The lower bound is the
main entry only; the upper bound imports consumer subpaths (`di`, `policy`, `hkt`), not
`@prodkit/op/internal` (extension-only).
Both leave `better-result` external as a peer.

## Local investigation

When CodSpeed flags a regression, use the profile harness for deeper analysis. CodSpeed flame
graphs can lose async stack traces; V8 `--cpu-prof` handles async code fine.

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/benchmarks run profile
pnpm --filter @prodkit/benchmarks run profile:cpu -- --scenario=compose.yieldChain
pnpm --filter @prodkit/benchmarks run profile:heap -- --scenario=compose.yieldChain
```

Refresh the public comparison table locally:

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/benchmarks run compare
pnpm --filter @prodkit/tools run performance:sync -- --write
```

See [`benchmarks/op/README.md`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op/README.md) for the full
profiling story and maintainer setup steps.
