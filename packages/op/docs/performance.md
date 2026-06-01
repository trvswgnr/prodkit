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
for native baselines, `@prodkit/op`, and future competitor columns. Scenario definitions and
contributor commands live in
[`benchmarks/op/README.md`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op/README.md).

## Latest comparison snapshot

<!-- op-performance-snapshot:start -->

Captured on **2026-06-01** at commit [`9bf6746`](https://github.com/trvswgnr/prodkit/commit/9bf6746bd0f6f30c8d0d2c4dd4fe9aea2f8c5ad5) (`@prodkit/op@0.1.77`).
Environment: v24.14.1, darwin/arm64.
Versus-native ratios use native ops/sec divided by library ops/sec (values above 1x mean slower than native).
Add library columns by extending `IMPLEMENTATION_COLUMNS` and scenario implementations in `benchmarks/op/comparison-matrix.ts`.

### Runtime overhead

| Scenario | Native baseline | Native baseline ops/sec | @prodkit/op | @prodkit/op ops/sec | @prodkit/op vs native | effect | effect ops/sec | effect vs native |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Single value | `Promise.resolve(x)` | 13,260,321.01 | `Op.of(x).run()` | 2,216,833.74 | 5.98x | `Effect.runPromise(Effect.succeed(x))` | 1,979,283.74 | 6.70x |
| Parallel batch (8 children) | `Promise.all([...])` | 1,552,523.84 | `Op.all([...]).run()` | 94,220.16 | 16.48x | `Effect.all(..., { concurrency: 'unbounded' })` | 25,650.14 | 60.53x |
| First success (8 children) | Hand-rolled first success + abort | 61,497.08 | `Op.any([...]).run()` | 37,687.96 | 1.63x | `Effect.firstSuccessOf([...])` | 635,013.94 | 10.33x faster |
| First settler (8 children) | Hand-rolled first settler + abort | 61,602.9 | `Op.race([...]).run()` | 37,568.1 | 1.64x | `Effect.raceFirst` folded over children | 10,755.72 | 5.73x |
| Retry loop | Hand-rolled try/catch retry | 247,787.57 | `Op.try(...).with(Policy.retry(...)).run()` | 50,556.01 | 4.90x | `Effect.retry(..., { times, schedule })` | 46,386.63 | 5.34x |
| Timeout guard | `Promise.race` + `setTimeout` | 3,762,825.75 | `Op.of(x).with(Policy.timeout(ms)).run()` | 338,600.29 | 11.11x | `Effect.timeout(ms)` | 127,647.14 | 29.48x |
| Sequential compose (6 steps) | `await Promise.resolve` chain | 3,366,007.07 | `yield* Op.of` generator chain | 276,768.62 | 12.16x | `Effect.gen` + `yield* Effect.succeed` chain | 930,100.44 | 3.62x |

### Bundle size

| Metric | Size |
| --- | --- |
| ESM entry minified | 1,771 B |
| ESM entry minified + gzip | 831 B |

<!-- op-performance-snapshot:end -->

Microbenchmarks measure hot-path overhead, not application latency under I/O. Prefer slowdown
ratios over raw ops/sec when comparing machines.

## Automated regression detection

**Runtime:** CodSpeed runs on every push to `main` and every pull request
([`.github/workflows/codspeed.yml`](https://github.com/trvswgnr/prodkit/blob/main/.github/workflows/codspeed.yml)).
Simulation mode tracks sync hot paths (`compose.rawSyncYieldStar`). Walltime mode tracks Op absolute timings and `overhead.*.ratio` gap benches (native work runs inside the ratio bench, not as separate dashboard series). CodSpeed comments on pull requests;
track history on the [CodSpeed dashboard](https://codspeed.io/trvswgnr/prodkit).

**Bundle size:** The CI `bundle-size` job uses `compressed-size-action` to compare minified + gzip
size of the `@prodkit/op` ESM entry on pull requests.

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
