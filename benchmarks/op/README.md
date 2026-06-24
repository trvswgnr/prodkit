# Benchmarks

This workspace measures `@prodkit/op` runtime overhead and bundle size. Public numbers and
interpretation live in [`packages/op/docs/performance.md`](../../packages/op/docs/performance.md).

Performance work uses four layers:

1. **CodSpeed** (CI): automated runtime regression detection on every push and pull request.
2. **compressed-size-action** (CI): automated bundle-size comparison on pull requests.
3. **`compare.ts` + `performance:sync`** (local / CI artifact): column-driven native baseline plus library ops/sec and vs-native ratios for the public table in `packages/op/docs/performance.md`.
4. **`profile.ts`** (local): V8 CPU/heap profiling and overhead breakdown when you need to investigate a regression.

## Comparison matrix

Scenario semantics live in [`comparison-matrix.ts`](comparison-matrix.ts). Each row defines `implementations` keyed by column id; `native` is the baseline and competitors (`@prodkit/op`, `effect`) run the same workload shape. Add columns by extending `IMPLEMENTATION_COLUMNS` and each scenario's `implementations` map.

| Output | Harness | Purpose |
| --- | --- | --- |
| Public snapshot table | `compare.ts` -> `performance:sync` | User-facing absolute ops/sec and vs-native ratios (native, Op, Effect) |
| CI regression guard | CodSpeed walltime + `overhead.*.ratio` | Track absolute timings and gap changes |
| Sync hot path | CodSpeed simulation (`compose.rawSyncYieldStar`) | Generator dispatch without async noise |
| Deep dive | `profile.ts` | Flame graphs and compose breakdown |

Shared scenario definitions live in `scenarios.ts`. The comparison matrix, CodSpeed benches, profile harness, and Vitest smoke tests import from there so semantics stay aligned.

## What is measured

Runtime (comparison matrix / CodSpeed walltime):

- Single-op overhead (`Op.of(...).run()` vs raw async resolve)
- Parallel aggregation (`Op.all` vs `Promise.all`, 8 children)
- First success (`Op.any` vs hand-rolled first success)
- First settler (`Op.race` vs hand-rolled first settler)
- Retry overhead (`Policy.retry` vs hand-rolled retry loop, 3 runs with 2 retries)
- Timeout overhead (`Policy.timeout` vs `Promise.race` + `setTimeout`)
- Sequential composition (native async chain vs Op yield* chain)

Runtime (CodSpeed extras):

- Op compose breakdown (`opFlatLoop`, `opSequentialRuns`)
- Sync reference (`compose.rawSyncYieldStar`, simulation only)
- Overhead ratio benches (`overhead.*.ratio`; native baselines run inside the bench, not as separate CodSpeed series)

Bundle size (compressed-size-action and compare report):

- `@prodkit/op` ESM entry minified + gzip bytes (`tsdown` build, then esbuild minify of `dist/index.mjs`)

## Commands

Comparison output goes under `op/.artifacts/` (gitignored). Profiler JSON reports, CPU profiles,
and heap profiles go under `.profiles/op/` (also gitignored) so profiling output stays outside the
code directory.

From repo root:

```bash
pnpm run bench
pnpm --filter @prodkit/benchmarks run codspeed:bench
pnpm --filter @prodkit/benchmarks run compare
pnpm --filter @prodkit/benchmarks run compare -- --time=1000 --repeats=5
pnpm --filter @prodkit/benchmarks run compare -- --pair=op,effect
pnpm --filter @prodkit/benchmarks run compare:refs -- --base=main --candidate=HEAD
pnpm --filter @prodkit/tools run performance:sync -- --write
```

Build `@prodkit/op` before running benches locally. CodSpeed instrumentation activates in CI (or
with the CodSpeed CLI); locally, Vitest runs plain wall-clock benches for a sanity check. Local
Tinybench commands accept `--time=`, `--warmup-time=`, `--warmup-iterations=`, and `--repeats=`.
When `--repeats` is above `1`, reports keep the median-throughput run as the main cell and include
raw repeat samples under `repeats`.

CI publishes runtime regressions via CodSpeed (see [`.github/workflows/codspeed.yml`](../../.github/workflows/codspeed.yml)), bundle-size deltas via `compressed-size-action`, and uploads a comparison report artifact from the walltime job.

### CodSpeed bench entrypoints

| Script | File | CI mode |
| --- | --- | --- |
| `codspeed:bench:sync` | `codspeed.sync.bench.ts` | simulation |
| `codspeed:bench:walltime` | `codspeed.walltime.bench.ts` | walltime |
| `codspeed:bench` | both | local sanity check |

CI runs two CodSpeed jobs:

- **simulation**: instruction counting via Valgrind. Deterministic. Best for sync hot paths.
- **walltime**: controlled wall-clock with statistical change detection. Tracks `@prodkit/op` absolute timings, `overhead.*.ratio` gap benches (native work runs inside the ratio bench, not as separate dashboard series), and Op compose breakdown scenarios. Also runs `compare` and uploads `op/.artifacts/comparison-report.json` as a workflow artifact.

CodSpeed comments on pull requests with regression data and flame graphs (simulation mode). Track history on the [CodSpeed dashboard](https://codspeed.io/trvswgnr/prodkit).

Walltime benches track Op absolute timings plus `overhead.*.ratio` benches that measure Op-vs-native gap drift. Native baselines stay in `compare.ts` for the public table; ratio benches run native work internally without publishing separate CodSpeed series.

### CodSpeed setup (maintainers, one-time)

1. Sign up at [codspeed.io](https://codspeed.io) and import `trvswgnr/prodkit`.
2. Install the CodSpeed GitHub App on the repository.
3. Trigger the CodSpeed workflow on `main` (`workflow_dispatch` or push). CodSpeed backtests to establish baseline data; subsequent PRs get regression comments automatically.

### Public comparison table

`compare.ts` runs the same scenario matrix with `tinybench`, writes `op/.artifacts/comparison-report.json`, and `performance:sync` renders the snapshot block in `packages/op/docs/performance.md`.

To add another competitor column, extend `IMPLEMENTATION_COLUMNS` and each scenario's `implementations` in `comparison-matrix.ts` (see `effect-scenarios.ts` for the Effect column). `compare.ts` and `tools/update-op-performance-doc.ts` read column ids from the report automatically. CodSpeed walltime benches stay Op-only.

`compare --pair=op,effect` prints a direct head-to-head table (winner + margin) and stores the same data under `pair` in `op/.artifacts/comparison-report.json`.

### Official report and diff

`compare` and `profile` also write official report metadata into their JSON output. The official
fields include the schema version, run id, runner identity, commit metadata, package version,
dependency fingerprint, benchmark options, scenario-level statistics, variance fields, and artifact
references. The legacy comparison fields remain in `comparison-report.json` so
`performance:sync` can keep reading the same shape.

Compare two compatible official reports with:

```bash
pnpm --filter @prodkit/benchmarks run report:diff -- base-report.json candidate-report.json
pnpm --filter @prodkit/benchmarks run report:diff -- base-report.json candidate-report.json --implementation=op
```

Diff verdicts use throughput deltas plus each scenario's relative margin of error. Small movements
inside the noise threshold are reported as inconclusive instead of being treated as regressions or
improvements.

For trusted base/candidate decisions, run both refs on the same machine in one session:

```bash
pnpm --filter @prodkit/benchmarks run compare:refs -- --base=main --candidate=HEAD
pnpm --filter @prodkit/benchmarks run compare:refs -- --base=op-v0.2.2 --candidate=my-branch --time=1000 --repeats=5
```

`compare:refs` requires a clean worktree, resolves both refs to detached Git worktrees, installs
dependencies, builds `@prodkit/op` for each ref, and benchmarks the built package entrypoints. It
alternates base-first and candidate-first scenario execution to reduce ordering bias, writes a
single trusted comparison report under `op/.artifacts/`, and prints the same verdict summary used
by `report:diff`.

### Bundle size

The CI `bundle-size` job uses [`preactjs/compressed-size-action`](https://github.com/preactjs/compressed-size-action) to build the PR branch and target branch, bundle and minify lower and upper bound artifacts with esbuild (`better-result` external), and compare gzip sizes. Lower bound is the main entry; upper bound is a fixture that imports consumer subpaths (`di`, `policy`, `hkt`), excluding `@prodkit/op/internal`. It comments on pull requests automatically.

Measurement matches the compare harness (`pnpm run build:size` / `compare.ts`). Fork PRs cannot receive comments (GitHub permission model); the job still prints the comparison to stdout.

## Profiling sequential composition

CodSpeed reports end-to-end scenario timings. The profile harness decomposes the compose path into comparable scenarios and reports `tinybench` statistics (mean, min/max, standard error, relative margin of error).

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/benchmarks run profile
pnpm --filter @prodkit/benchmarks run profile -- --report=.profiles/op/profile.json
pnpm --filter @prodkit/benchmarks run profile -- --time=1000 --repeats=3
pnpm --filter @prodkit/benchmarks run profile -- --steps=12
```

When CodSpeed flags a regression, use `profile.ts` for deep investigation. The profile registry
accepts CodSpeed bench names such as `all.opAll`, `overhead.timeout.ratio`, and
`compose.opYieldChain` through `--scenario=...`. CodSpeed flame graphs can lose async stack traces;
V8 `--cpu-prof` handles async code fine.

### Async scenarios (included in baseline ratios)

| Scenario | What it isolates |
| --- | --- |
| `baseline.asyncChain` | Native `await Promise.resolve` chain |
| `baseline.asyncFnChain` | Microtask cost from awaiting sync values through async functions |
| `compose.yieldChain` | Full `yield* Op.of` path (matches `compose.opYieldChain` in CodSpeed benches) |
| `compose.flatOp` | Single Op / single driver pass (no nested `yield*`) |
| `compose.sequentialRuns` | Per-step `Op.of(...).run()` without `yield*` delegation |
| `compose.singleValueRun` | One `Op.of(x).run()` |

### CodSpeed scenarios

The profile command also includes the walltime CodSpeed scenarios:

- Op absolute benches from the comparison matrix, for example `singleValue.opRun`, `all.opAll`,
  `retry.opWithPolicyRetry`, and `timeout.opWithPolicyTimeout`.
- Ratio benches from the same matrix, for example `overhead.all.ratio` and
  `overhead.timeout.ratio`.
- Compose extras, `compose.opFlatLoop` and `compose.opSequentialRuns`.

### Sync reference (excluded from async baseline ratios)

| Scenario | What it isolates |
| --- | --- |
| `compose.rawSyncYieldStar` | Raw sync `yield*` (no Op, no async driver) |

Filter to one scenario:

```bash
pnpm --filter @prodkit/benchmarks run profile -- --scenario=overhead.timeout.ratio
```

For flame graphs and allocation profiles:

```bash
pnpm --filter @prodkit/benchmarks run profile:cpu -- --scenario=compose.opYieldChain
pnpm --filter @prodkit/benchmarks run profile:heap -- --scenario=all.opAll
```

Node writes `CPU.*.cpuprofile` or `Heap.*.heapprofile` under `.profiles/op/`.
The profile command prints the resolved artifact path when it can detect it.

Use `--package-dir=` to profile a packed install tree instead of the workspace build.

## Tests

Scenario correctness is covered by Vitest smoke tests:

```bash
pnpm --filter @prodkit/benchmarks run test
```

`@prodkit/op` is listed as a workspace devDependency so Turbo runs `^build` before benchmark tests. The profile harness loads the built ESM entry via `importOpModule` (not a TypeScript import of source), matching how consumers load the package.

## Contributor guidance

- Trust CodSpeed PR comments and the dashboard for regression signals, not local wall-clock numbers.
- Refresh `packages/op/docs/performance.md` with `compare` + `performance:sync --write` when the public snapshot should change.
- Use `profile.ts` after a CodSpeed regression to isolate overhead sources.
- Keep scenario semantics aligned between `comparison-matrix.ts`, `scenarios.ts`, CodSpeed benches, and `profile.ts` when adding or changing workloads.
