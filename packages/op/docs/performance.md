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

Captured on **2026-06-20** at commit [`7677cf2`](https://github.com/trvswgnr/prodkit/commit/7677cf282dde949d1e03dbb0b7ecde1041aee8f9) (`@prodkit/op@0.2.2`).
Environment: v24.14.1, darwin/arm64.
Versus-native ratios use native ops/sec divided by library ops/sec (values above 1x mean slower than native).
Add library columns by extending `IMPLEMENTATION_COLUMNS` and scenario implementations in `benchmarks/op/comparison-matrix.ts`.

### Runtime overhead

| Scenario | Native baseline | Native baseline ops/sec | @prodkit/op | @prodkit/op ops/sec | @prodkit/op vs native | effect | effect ops/sec | effect vs native |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Single value | `Promise.resolve(x)` | 11,680,745.89 | `Op.of(x).run()` | 2,698,196.79 | 4.33x | `Effect.runPromise(Effect.succeed(x))` | 1,810,816.85 | 6.45x |
| Parallel batch (8 children) | `Promise.all([...])` | 1,515,481.46 | `Op.all([...]).run()` | 179,025.04 | 8.47x | `Effect.all(..., { concurrency: 'unbounded' })` | 24,851.68 | 60.98x |
| First success (8 children) | Hand-rolled first success + abort | 57,198.97 | `Op.any([...]).run()` | 37,943.41 | 1.51x | `Effect.firstSuccessOf([...])` | 607,783.69 | 10.63x faster |
| First settler (8 children) | Hand-rolled first settler + abort | 58,014.22 | `Op.race([...]).run()` | 38,535.68 | 1.51x | `Effect.raceFirst` folded over children | 10,838.84 | 5.35x |
| Retry loop | Hand-rolled try/catch retry | 217,988.48 | `Op.try(...).with(Policy.retry(...)).run()` | 41,604.64 | 5.24x | `Effect.retry(..., { times, schedule })` | 43,546.16 | 5.01x |
| Timeout guard | `Promise.race` + `setTimeout` | 3,562,176.38 | `Op.of(x).with(Policy.timeout(ms)).run()` | 373,527.27 | 9.54x | `Effect.timeout(ms)` | 123,296.12 | 28.89x |
| Sequential compose (6 steps) | `await Promise.resolve` chain | 3,316,170.85 | `yield* Op.of` generator chain | 361,338.42 | 9.18x | `Effect.gen` + `yield* Effect.succeed` chain | 881,473.82 | 3.76x |

### Bundle size

Lower bound: bundled main entry only. Upper bound: bundled import of consumer subpaths
(`@prodkit/op`, `@prodkit/op/di`, `@prodkit/op/policy`, `@prodkit/op/hkt`).
`@prodkit/op/internal` is extension-only and is excluded. `better-result` is external in both cases.

| Metric | Size |
| --- | --- |
| Lower bound (main entry) minified | 17,506 B |
| Lower bound (main entry) minified + gzip | 5,683 B |
| Upper bound (consumer subpaths) minified | 24,954 B |
| Upper bound (consumer subpaths) minified + gzip | 7,901 B |

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
pnpm --filter @prodkit/benchmarks run profile:cpu -- --scenario=compose.opYieldChain
pnpm --filter @prodkit/benchmarks run profile:heap -- --scenario=all.opAll
```

Use CodSpeed scenario names with `--scenario=...` when a regression comment names a specific
bench, for example `overhead.timeout.ratio`.

Refresh the public comparison table locally:

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/benchmarks run compare -- --time=1000 --repeats=5
pnpm --filter @prodkit/tools run performance:sync -- --write
```

See [`benchmarks/op/README.md`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op/README.md) for the full
profiling story and maintainer setup steps.
