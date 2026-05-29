# Benchmarks

This workspace measures `@prodkit/op` runtime overhead and bundle size. Repo-wide orientation lives in [`BENCHMARKS.md`](../../BENCHMARKS.md).

## What is measured

Runtime scenarios share one matrix in `comparison-matrix.ts`:

- Single-op overhead (`Op.of(...).run()` vs raw async resolve)
- Parallel aggregation (`Op.all` vs `Promise.all`)
- First success (`Op.any` vs hand-rolled first success + abort)
- First settler (`Op.race` vs hand-rolled first settler + abort)
- Retry overhead (`withRetry` vs a hand-rolled retry loop)
- Timeout overhead (`withTimeout` vs `Promise.race` + `setTimeout`)
- Sequential composition (native async chain vs Op yield* chain)

CodSpeed walltime benches also include compose breakdown scenarios (`asyncFnChain`, `opFlatLoop`, `opSequentialRuns`) and a sync reference bench (`compose.rawSyncYieldStar`, simulation mode only).

Bundle-size scenario (CI `bundle-size` job):

- package ESM entrypoint minified + gzip bytes (esbuild minify after `tsdown` build)

Shared scenario definitions live in `scenarios.ts`. The comparison matrix, CodSpeed benches, profile harness, and Vitest smoke tests import from there so semantics stay aligned.

## Commands

From repo root:

```bash
pnpm run bench
pnpm --filter @prodkit/op-benchmarks run codspeed:bench
pnpm --filter @prodkit/op-benchmarks run compare -- --report=comparison-report.json
pnpm --filter @prodkit/tools run performance:sync -- --write
```

Build `@prodkit/op` before running benches locally. CodSpeed instrumentation activates in CI (or with the CodSpeed CLI); locally, Vitest runs plain wall-clock benches for a sanity check.

CI publishes runtime regressions via CodSpeed (see [`.github/workflows/codspeed.yml`](../../.github/workflows/codspeed.yml)), bundle-size deltas via `compressed-size-action`, and uploads a comparison report artifact from the walltime job. See [`packages/op/PERFORMANCE.md`](../../packages/op/PERFORMANCE.md) for the public snapshot table.

### CodSpeed bench entrypoints

| Script | File | CI mode |
| --- | --- | --- |
| `codspeed:bench:sync` | `codspeed.sync.bench.ts` | simulation |
| `codspeed:bench:walltime` | `codspeed.walltime.bench.ts` | walltime |
| `codspeed:bench` | both | local sanity check |

Walltime benches include absolute native/op timings plus `overhead.*.ratio` benches that track the Op-vs-native gap.

### Public comparison table

`compare.ts` runs the same scenario matrix with `tinybench`, writes `comparison-report.json`, and `performance:sync` renders the snapshot block in `packages/op/PERFORMANCE.md`.

To add a competitor column later, extend `IMPLEMENTATION_COLUMNS` and the runners in `comparison-matrix.ts`, then teach `compare.ts` and `tools/update-op-performance-doc.ts` about the new column id.

## Profiling sequential composition

CodSpeed reports end-to-end scenario timings. The profile harness decomposes the compose path into comparable scenarios and reports `tinybench` statistics (mean, min/max, standard error, relative margin of error).

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
| `compose.yieldChain` | Full `yield* Op.of` path (matches `compose.opYieldChain` in CodSpeed benches) |
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

`@prodkit/op` is listed as a workspace devDependency so Turbo runs `^build` before benchmark tests. The profile harness loads the built ESM entry via `importOpModule` (not a TypeScript import of source), matching how consumers load the package.

## Contributor guidance

- Trust CodSpeed PR comments for regression detection; local wall-clock numbers are noisy.
- Refresh `PERFORMANCE.md` with `compare` + `performance:sync --write` when the public snapshot should change.
- Use `profile.ts` after a CodSpeed regression to isolate overhead sources.
- Keep benchmark scenario semantics equivalent when adding or changing tests.
