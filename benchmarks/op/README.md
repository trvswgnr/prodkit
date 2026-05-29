# Benchmarks

This harness exists to answer two questions:

1. Did this branch regress vs the latest commit on `main`?
2. How does this branch compare to the latest published npm release?

For sequential-compose optimization work, use the profile harness (below) to isolate overhead
sources and write machine-readable reports.

## What is measured

Runtime scenarios (via `tinybench`):

- Single-op overhead (`Op.of(...).run()` vs raw async resolve)
- Parallel aggregation (`Op.all` vs `Promise.all`)
- First success (`Op.any` vs hand-rolled first success + abort)
- First settler (`Op.race` vs hand-rolled first settler + abort)
- Retry overhead (`withRetry` vs a hand-rolled retry loop)
- Timeout overhead (`withTimeout` vs `Promise.race` + `setTimeout`)
- Sequential composition (`yield* Op.of` chain vs `await Promise.resolve` chain)

Bundle-size scenario:

- package ESM entrypoint minified bytes
- package ESM entrypoint minified+gzip bytes

Shared scenario definitions live in `scenarios.ts`. Regression and profile harnesses import
from there so semantics stay aligned.

## Commands

From repo root:

```bash
pnpm run bench
pnpm --filter @prodkit/op-benchmarks run bench -- --baseline=main
pnpm --filter @prodkit/op-benchmarks run bench -- --baseline=npm
pnpm --filter @prodkit/op-benchmarks run bench -- --report=report.json
```

- `pnpm run bench` defaults to `--baseline=main`.
- Use `pnpm --filter @prodkit/op-benchmarks run bench -- --baseline=npm` when you want drift against the latest published package.
- Use `--report=<path>` to write machine-readable results (`overhead.*.slowdownRatio`, runtime hz, bundle size). CI uploads this as the `op-benchmarks` artifact; see [`packages/op/PERFORMANCE.md`](../../packages/op/PERFORMANCE.md) for how to read them.
- Refresh the public performance snapshot with `pnpm --filter @prodkit/tools run performance:sync -- --write` after generating `report.json`.

## Profiling sequential composition

The regression harness reports end-to-end slowdown ratios. The profile harness decomposes the
same compose path into comparable async scenarios and reports `tinybench` statistics (mean,
min/max, standard error, relative margin of error).

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/op-benchmarks run profile
pnpm --filter @prodkit/op-benchmarks run profile -- --report=profile.json
pnpm --filter @prodkit/op-benchmarks run profile -- --steps=12
```

### Async scenarios (included in baseline ratios)

| Scenario | What it isolates |
| --- | --- |
| `baseline.asyncChain` | Native `await Promise.resolve` chain |
| `baseline.asyncFnChain` | Microtask cost from awaiting sync values through async functions |
| `compose.yieldChain` | Full `yield* Op.of` path (matches `compose.opYieldChain` in bench) |
| `compose.flatOp` | Single Op / single driver pass (no nested `yield*`) |
| `compose.sequentialRuns` | Per-step `Op.of(...).run()` without `yield*` delegation |
| `compose.singleOpRun` | One `Op.of(x).run()` |

### Sync reference (excluded from async baseline ratios)

| Scenario | What it isolates |
| --- | --- |
| `generator.rawYieldStarSync` | Raw sync `yield*` (no Op, no async driver) |

Filter to one scenario:

```bash
pnpm --filter @prodkit/op-benchmarks run profile -- --scenario=compose.yieldChain
```

For flame graphs and allocation profiles:

```bash
pnpm --filter @prodkit/op-benchmarks run profile:cpu -- --scenario=compose.yieldChain
pnpm --filter @prodkit/op-benchmarks run profile:heap -- --scenario=compose.yieldChain
```

Node writes `CPU.*.cpuprofile` or `Heap.*.heapprofile` in the current working directory.
The profile command prints the resolved artifact path when it can detect it.

Use `--package-dir=` to profile a packed install tree instead of the workspace build.

## Tests

Scenario correctness is covered by Vitest smoke tests:

```bash
pnpm --filter @prodkit/op-benchmarks run test
```

`@prodkit/op` is listed as a workspace devDependency so Turbo runs `^build` before benchmark
tests. The harness still loads the built ESM entry via `importOpModule` (not a TypeScript import
of source), matching how regression bench consumes the package.

## Contributor guidance

- Treat all numbers as directional and machine-dependent.
- Compare runs on the same machine and similar background load.
- Focus on relative deltas more than absolute ops/sec.
- If a regression appears, rerun once before concluding.
- Keep benchmark scenario semantics equivalent when adding/changing tests.
