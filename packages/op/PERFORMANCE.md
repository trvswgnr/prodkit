# Performance

`@prodkit/op` is a generator-based runtime with instruction dispatch on every step.
Microbenchmarks show measurable overhead compared with raw `Promise` usage. That is expected.
The library trades a small amount of hot-path cost for typed failures, structured concurrency,
cancellation propagation, and composable retry/timeout policy.

Use these numbers to judge whether that tradeoff fits your workload. Real applications are
usually dominated by I/O, so relative overhead matters less once network or database latency is
in the picture.

The harness in [`benchmarks/op`](https://github.com/trvswgnr/prodkit/blob/main/benchmarks/op)
runs paired scenarios with `tinybench`. See repo-root
[`BENCHMARKS.md`](https://github.com/trvswgnr/prodkit/blob/main/BENCHMARKS.md) for methodology
and CI artifacts.

## Latest snapshot

<!-- op-performance-snapshot:start -->

Captured on **2026-05-28** at commit [`9cbf3e7`](https://github.com/trvswgnr/prodkit/commit/9cbf3e73ee6766f3a85a7756df8084b925bb9618) (`@prodkit/op@0.1.70`).
Environment: v24.14.1, darwin/arm64.
Slowdown ratios compare Op paths to native Promise equivalents on the same machine.

### Runtime overhead

| Scenario | Native baseline | Native ops/sec | Op variant | Op ops/sec | Slowdown |
| --- | --- | --- | --- | --- | --- |
| Single value | `Promise.resolve(x)` | 14,116,954.61 | `Op.of(x).run()` | 995,394.74 | 13.87x |
| Parallel batch (8 children) | `Promise.all([...])` | 1,597,441.41 | `Op.all([...]).run()` | 99,385.52 | 16.52x |
| First success (8 children) | Hand-rolled first success + abort | 65,986.64 | `Op.any([...]).run()` | 39,920.07 | 1.63x |
| First settler (8 children) | Hand-rolled first settler + abort | 66,360.75 | `Op.race([...]).run()` | 40,193.01 | 1.65x |
| Retry loop | Hand-rolled try/catch retry | 251,010.87 | `Op.try(...).withRetry(...).run()` | 51,771.73 | 4.90x |
| Timeout guard | `Promise.race` + `setTimeout` | 3,942,961.54 | `Op.of(x).withTimeout(ms).run()` | 295,824.99 | 12.37x |
| Sequential compose (6 steps) | `await Promise.resolve` chain | 4,138,976 | `yield* Op.of` generator chain | 165,095.13 | 25.36x |

### Bundle size

| Metric | Size |
| --- | --- |
| ESM entry minified | 14,652 B |
| ESM entry minified + gzip | 4,132 B |

<!-- op-performance-snapshot:end -->

## Refresh locally

From the repo root:

```bash
pnpm run bench
pnpm --filter @prodkit/op-benchmarks run bench -- --report=report.json
pnpm --filter @prodkit/tools run performance:sync -- --write
```

Treat all numbers as directional. Rerun locally if a result surprises you.
