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
[`benchmarks/op/README.md`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op/README.md)
and [`BENCHMARKS.md`](https://github.com/trvswgnr/prodkit/blob/main/BENCHMARKS.md).

## Latest comparison snapshot

<!-- op-performance-snapshot:start -->

Captured on **2026-05-29** at commit [`6756b8e`](https://github.com/trvswgnr/prodkit/commit/6756b8ed741103eefb75b185a6c359e1f4058f86) (`@prodkit/op@0.1.72`).
Environment: v24.14.1, darwin/arm64.
Slowdown ratios compare `@prodkit/op` to native Promise equivalents on the same machine.
Add competitor library columns by extending `IMPLEMENTATION_COLUMNS` in `benchmarks/op/comparison-matrix.ts`.

### Runtime overhead

| Scenario | Native baseline | Native ops/sec | @prodkit/op | Op ops/sec | Slowdown (Op vs native) |
| --- | --- | --- | --- | --- | --- |
| Single value | `Promise.resolve(x)` | 13,979,344.13 | `Op.of(x).run()` | 2,297,743.66 | 6.08x |
| Parallel batch (8 children) | `Promise.all([...])` | 1,629,319.02 | `Op.all([...]).run()` | 125,767.64 | 12.95x |
| First success (8 children) | Hand-rolled first success + abort | 66,904.93 | `Op.any([...]).run()` | 44,954.87 | 1.49x |
| First settler (8 children) | Hand-rolled first settler + abort | 67,518.34 | `Op.race([...]).run()` | 45,310.72 | 1.49x |
| Retry loop | Hand-rolled try/catch retry | 253,778.19 | `Op.try(...).withRetry(...).run()` | 52,777.02 | 4.81x |
| Timeout guard | `Promise.race` + `setTimeout` | 3,943,086.51 | `Op.of(x).withTimeout(ms).run()` | 322,670.05 | 12.22x |
| Sequential compose (6 steps) | `await Promise.resolve` chain | 3,643,161.02 | `yield* Op.of` generator chain | 269,297.7 | 13.53x |

### Bundle size

| Metric | Size |
| --- | --- |
| ESM entry minified | 12,781 B |
| ESM entry minified + gzip | 3,719 B |

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
pnpm --filter @prodkit/op-benchmarks run profile
pnpm --filter @prodkit/op-benchmarks run profile:cpu -- --scenario=compose.yieldChain
pnpm --filter @prodkit/op-benchmarks run profile:heap -- --scenario=compose.yieldChain
```

Refresh the public comparison table locally:

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/op-benchmarks run compare -- --report=comparison-report.json
pnpm --filter @prodkit/tools run performance:sync -- --write
```

See [`BENCHMARKS.md`](https://github.com/trvswgnr/prodkit/blob/main/BENCHMARKS.md) for the full
profiling story and maintainer setup steps.
