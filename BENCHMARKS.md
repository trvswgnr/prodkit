# Benchmarks

This document explains how `@prodkit/op` runtime overhead is measured and where to find the latest results.

## Why these numbers exist

`@prodkit/op` is a generator-based runtime with instruction dispatch on every step. Microbenchmarks will show measurable overhead compared with raw `Promise` usage. That is expected. The library trades a small amount of hot-path cost for typed failures, structured concurrency, cancellation propagation, and composable retry/timeout policy.

Use the benchmarks to judge whether that tradeoff fits your workload. Real applications are usually dominated by I/O, not resolving a constant in a tight loop.

## What is measured

The harness in [`benchmarks/op/bench.ts`](benchmarks/op/bench.ts) runs paired scenarios with `tinybench`:

| Scenario | Native baseline | Op variant |
| --- | --- | --- |
| Single value | `Promise.resolve(x)` | `Op.of(x).run()` |
| Parallel batch | `Promise.all([...])` (8 children) | `Op.all([...]).run()` |
| Retry loop | Hand-rolled try/catch retry | `Op.try(...).withRetry(...).run()` |
| Timeout guard | `Promise.race` + `setTimeout` | `Op.of(x).withTimeout(ms).run()` |

It also records minified and gzip size for the published ESM entrypoint.

## How to read results

Each CI run uploads `report.json` with:

- Absolute ops/sec and mean latency per scenario
- Branch-vs-baseline deltas (default baseline is latest `main`)
- `overhead.*.slowdownRatio`: how many times slower the Op path is than its native pair on the same machine

Prefer slowdown ratios over raw ops/sec when comparing machines. Absolute throughput varies by CPU and OS; paired ratios on one run are the useful signal.

Treat all numbers as directional. Rerun locally if a result surprises you.

## Latest canonical results

CI publishes an `op-benchmarks` artifact on every push and pull request to `main`. Download `report.json` from the latest successful [`CI` workflow run](https://github.com/trvswgnr/prodkit/actions/workflows/ci.yml) on `main`.

Look at `overhead.singleOp`, `overhead.all`, and `overhead.retry` first. Those answer the most common adoption question: how much does Op cost compared with doing the same thing in plain Promise code?

## Reproduce locally

From the repo root:

```bash
pnpm run bench
pnpm --filter @prodkit/op-benchmarks run bench -- --report=report.json
```

- Default baseline is latest commit on `main`.
- Use `--baseline=npm` to compare against the latest published npm release.
- Scenario definitions and contributor guidance live in [`benchmarks/op/README.md`](benchmarks/op/README.md).
