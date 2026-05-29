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

Captured on **2026-05-29** at commit [`7acc286`](https://github.com/trvswgnr/prodkit/commit/7acc2867bf1da142758be3bea1b6fe917c3c5b95) (`@prodkit/op@0.1.72`).
Environment: v24.14.1, darwin/arm64.
Versus-native ratios use native ops/sec divided by library ops/sec (values above 1x mean slower than native).
Add library columns by extending `IMPLEMENTATION_COLUMNS` and scenario implementations in `benchmarks/op/comparison-matrix.ts`.

### Runtime overhead

| Scenario | Native baseline | Native baseline ops/sec | @prodkit/op | @prodkit/op ops/sec | @prodkit/op vs native | effect | effect ops/sec | effect vs native |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Single value | `Promise.resolve(x)` | 13,314,986.59 | `Op.of(x).run()` | 2,294,811.7 | 5.80x | `Effect.runPromise(Effect.succeed(x))` | 1,998,755.32 | 6.66x |
| Parallel batch (8 children) | `Promise.all([...])` | 1,601,262.93 | `Op.all([...]).run()` | 123,858.07 | 12.93x | `Effect.all(..., { concurrency: 'unbounded' })` | 26,925.05 | 59.47x |
| First success (8 children) | Hand-rolled first success + abort | 64,468.18 | `Op.any([...]).run()` | 43,412.65 | 1.49x | `Effect.firstSuccessOf([...])` | 657,306.92 | 10.20x faster |
| First settler (8 children) | Hand-rolled first settler + abort | 63,823.36 | `Op.race([...]).run()` | 43,300.63 | 1.47x | `Effect.raceFirst` folded over children | 11,516.78 | 5.54x |
| Retry loop | Hand-rolled try/catch retry | 254,546.86 | `Op.try(...).withRetry(...).run()` | 50,808.01 | 5.01x | `Effect.retry(..., { times, schedule })` | 48,237.74 | 5.28x |
| Timeout guard | `Promise.race` + `setTimeout` | 3,678,050.32 | `Op.of(x).withTimeout(ms).run()` | 315,388.35 | 11.66x | `Effect.timeout(ms)` | 134,374.8 | 27.37x |
| Sequential compose (6 steps) | `await Promise.resolve` chain | 3,507,651.31 | `yield* Op.of` generator chain | 262,939.89 | 13.34x | `Effect.gen` + `yield* Effect.succeed` chain | 947,189.57 | 3.70x |

### Bundle size

| Metric | Size |
| --- | --- |
| ESM entry minified | 12,738 B |
| ESM entry minified + gzip | 3,702 B |

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
