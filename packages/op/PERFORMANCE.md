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

Captured on **2026-05-31** at commit [`785920a`](https://github.com/trvswgnr/prodkit/commit/785920a3772cbea27dd0294bfd7ae87d67bca8fc) (`@prodkit/op@0.1.74`).
Environment: v24.14.1, darwin/arm64.
Versus-native ratios use native ops/sec divided by library ops/sec (values above 1x mean slower than native).
Add library columns by extending `IMPLEMENTATION_COLUMNS` and scenario implementations in `benchmarks/op/comparison-matrix.ts`.

### Runtime overhead

| Scenario | Native baseline | Native baseline ops/sec | @prodkit/op | @prodkit/op ops/sec | @prodkit/op vs native | effect | effect ops/sec | effect vs native |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Single value | `Promise.resolve(x)` | 13,388,486.68 | `Op.of(x).run()` | 2,249,524.28 | 5.95x | `Effect.runPromise(Effect.succeed(x))` | 1,993,726.95 | 6.72x |
| Parallel batch (8 children) | `Promise.all([...])` | 1,592,849.43 | `Op.all([...]).run()` | 126,517.6 | 12.59x | `Effect.all(..., { concurrency: 'unbounded' })` | 26,361.64 | 60.42x |
| First success (8 children) | Hand-rolled first success + abort | 61,418.45 | `Op.any([...]).run()` | 42,371.1 | 1.45x | `Effect.firstSuccessOf([...])` | 634,540.48 | 10.33x faster |
| First settler (8 children) | Hand-rolled first settler + abort | 61,726.01 | `Op.race([...]).run()` | 42,996.93 | 1.44x | `Effect.raceFirst` folded over children | 11,084.86 | 5.57x |
| Retry loop | Hand-rolled try/catch retry | 248,740.26 | `Op.try(...).with(Policy.retry(...)).run()` | 50,310.56 | 4.94x | `Effect.retry(..., { times, schedule })` | 47,151.61 | 5.28x |
| Timeout guard | `Promise.race` + `setTimeout` | 3,654,420.01 | `Op.of(x).with(Policy.timeout(ms)).run()` | 337,497.71 | 10.83x | `Effect.timeout(ms)` | 127,791.45 | 28.60x |
| Sequential compose (6 steps) | `await Promise.resolve` chain | 3,471,454.52 | `yield* Op.of` generator chain | 274,303.38 | 12.66x | `Effect.gen` + `yield* Effect.succeed` chain | 928,023.83 | 3.74x |

### Bundle size

| Metric | Size |
| --- | --- |
| ESM entry minified | 4,654 B |
| ESM entry minified + gzip | 1,576 B |

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
