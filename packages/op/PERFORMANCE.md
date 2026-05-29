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

Captured on **2026-05-29** at commit [`92a88fd`](https://github.com/trvswgnr/prodkit/commit/92a88fd79c24ce1a28a8cfa760aff71df12f0624) (`@prodkit/op@0.1.72`).
Environment: v24.14.1, darwin/arm64.
`@prodkit/op` ratios use native ops/sec divided by library ops/sec (values above 1x mean slower than native).
Add library columns by extending `IMPLEMENTATION_COLUMNS` and scenario implementations in `benchmarks/op/comparison-matrix.ts`.

### Runtime overhead

| Scenario | Native baseline | Native baseline ops/sec | @prodkit/op | @prodkit/op ops/sec | @prodkit/op vs native |
| --- | --- | --- | --- | --- | --- |
| Single value | `Promise.resolve(x)` | 13,631,902.24 | `Op.of(x).run()` | 2,332,606.5 | 5.84x |
| Parallel batch (8 children) | `Promise.all([...])` | 1,634,752.05 | `Op.all([...]).run()` | 127,949.51 | 12.78x |
| First success (8 children) | Hand-rolled first success + abort | 65,668.51 | `Op.any([...]).run()` | 43,929.53 | 1.49x |
| First settler (8 children) | Hand-rolled first settler + abort | 63,890.76 | `Op.race([...]).run()` | 44,089.99 | 1.45x |
| Retry loop | Hand-rolled try/catch retry | 253,920.1 | `Op.try(...).withRetry(...).run()` | 51,163.05 | 4.96x |
| Timeout guard | `Promise.race` + `setTimeout` | 3,828,285.53 | `Op.of(x).withTimeout(ms).run()` | 327,946.73 | 11.67x |
| Sequential compose (6 steps) | `await Promise.resolve` chain | 3,691,951.04 | `yield* Op.of` generator chain | 265,280.97 | 13.92x |

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
pnpm --filter @prodkit/op-benchmarks run profile
pnpm --filter @prodkit/op-benchmarks run profile:cpu -- --scenario=compose.yieldChain
pnpm --filter @prodkit/op-benchmarks run profile:heap -- --scenario=compose.yieldChain
```

Refresh the public comparison table locally:

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/op-benchmarks run compare
pnpm --filter @prodkit/tools run performance:sync -- --write
```

See [`benchmarks/op/README.md`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op/README.md) for the full
profiling story and maintainer setup steps.
