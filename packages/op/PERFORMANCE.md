# Performance

`@prodkit/op` is a generator-based runtime with instruction dispatch on every step.
Microbenchmarks show measurable overhead compared with raw `Promise` usage. That is expected.
The library trades a small amount of hot-path cost for typed failures, structured concurrency,
cancellation propagation, and composable retry/timeout policy.

Use these numbers to judge whether that tradeoff fits your workload. Real applications are
usually dominated by I/O, so relative overhead matters less once network or database latency is
in the picture.

The harness in [`benchmarks/op`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op)
runs paired scenarios with Vitest bench under CodSpeed in CI. Scenario definitions and contributor
commands live in [`benchmarks/op/README.md`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op/README.md)
and [`BENCHMARKS.md`](https://github.com/trvswgnr/prodkit/blob/main/BENCHMARKS.md).

## Automated regression detection

**Runtime:** CodSpeed runs on every push to `main` and every pull request
([`.github/workflows/codspeed.yml`](https://github.com/trvswgnr/prodkit/blob/main/.github/workflows/codspeed.yml)).
Simulation mode (instruction counting) covers sync hot paths; walltime mode covers async overhead.
CodSpeed comments on pull requests with regression data and flame graphs. Track history on the
[CodSpeed dashboard](https://codspeed.io/trvswgnr/prodkit).

**Bundle size:** The CI `bundle-size` job uses `compressed-size-action` to compare minified + gzip
size of the `@prodkit/op` ESM entry on pull requests.

Compare Op paths to their native Promise equivalents in the CodSpeed dashboard or PR comments.
Look at `singleOp`, `all`, `any`, `race`, `retry`, `timeout`, and `compose` groups first.

## Local investigation

When CodSpeed flags a regression, use the profile harness for deeper analysis. CodSpeed flame
graphs can lose async stack traces; V8 `--cpu-prof` handles async code fine.

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/op-benchmarks run profile
pnpm --filter @prodkit/op-benchmarks run profile:cpu -- --scenario=compose.yieldChain
pnpm --filter @prodkit/op-benchmarks run profile:heap -- --scenario=compose.yieldChain
```

For a local sanity check of bench scenarios (plain Vitest wall-clock, not CodSpeed):

```bash
pnpm run bench
```

See [`BENCHMARKS.md`](https://github.com/trvswgnr/prodkit/blob/main/BENCHMARKS.md) for the full
profiling story and maintainer setup steps.
