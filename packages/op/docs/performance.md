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

Captured on **2026-06-02** at commit [`1a7b470`](https://github.com/trvswgnr/prodkit/commit/1a7b470aa894ca2ab289b41f95aff49c674dcd20) (`@prodkit/op@0.1.78`).
Environment: v24.14.1, darwin/arm64.
Versus-native ratios use native ops/sec divided by library ops/sec (values above 1x mean slower than native).
Add library columns by extending `IMPLEMENTATION_COLUMNS` and scenario implementations in `benchmarks/op/comparison-matrix.ts`.

### Runtime overhead

| Scenario | Native baseline | Native baseline ops/sec | @prodkit/op | @prodkit/op ops/sec | @prodkit/op vs native | effect | effect ops/sec | effect vs native |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Single value | `Promise.resolve(x)` | 11,306,396.16 | `Op.of(x).run()` | 2,069,457.72 | 5.46x | `Effect.runPromise(Effect.succeed(x))` | 1,900,427.09 | 5.95x |
| Parallel batch (8 children) | `Promise.all([...])` | 1,550,075.56 | `Op.all([...]).run()` | 86,917.87 | 17.83x | `Effect.all(..., { concurrency: 'unbounded' })` | 25,156.43 | 61.62x |
| First success (8 children) | Hand-rolled first success + abort | 58,771.25 | `Op.any([...]).run()` | 35,467.75 | 1.66x | `Effect.firstSuccessOf([...])` | 605,271.82 | 10.30x faster |
| First settler (8 children) | Hand-rolled first settler + abort | 59,593.97 | `Op.race([...]).run()` | 35,586.38 | 1.67x | `Effect.raceFirst` folded over children | 10,819.81 | 5.51x |
| Retry loop | Hand-rolled try/catch retry | 243,530.75 | `Op.try(...).with(Policy.retry(...)).run()` | 49,464.3 | 4.92x | `Effect.retry(..., { times, schedule })` | 45,161.23 | 5.39x |
| Timeout guard | `Promise.race` + `setTimeout` | 3,540,759.79 | `Op.of(x).with(Policy.timeout(ms)).run()` | 295,601.48 | 11.98x | `Effect.timeout(ms)` | 122,079.85 | 29.00x |
| Sequential compose (6 steps) | `await Promise.resolve` chain | 3,248,484.02 | `yield* Op.of` generator chain | 252,287.87 | 12.88x | `Effect.gen` + `yield* Effect.succeed` chain | 868,595.55 | 3.74x |

### Bundle size

Lower bound: bundled main entry only. Upper bound: bundled import of consumer subpaths
(`@prodkit/op`, `@prodkit/op/di`, `@prodkit/op/policy`, `@prodkit/op/hkt`).
`@prodkit/op/internal` is extension-only and is excluded. `better-result` is external in both cases.

| Metric | Size |
| --- | --- |
| Lower bound (main entry) minified | 13,973 B |
| Lower bound (main entry) minified + gzip | 4,353 B |
| Upper bound (consumer subpaths) minified | 22,461 B |
| Upper bound (consumer subpaths) minified + gzip | 6,841 B |

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
