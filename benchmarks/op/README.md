# Benchmarks

This workspace measures `@prodkit/op` runtime overhead and bundle size. Public numbers and
interpretation live in [`packages/op/docs/performance.md`](../../packages/op/docs/performance.md).

Performance work uses four layers:

1. **CodSpeed** (CI): automated runtime regression detection on every push and pull request.
2. **compressed-size-action** (CI): automated bundle-size comparison on pull requests.
3. **`cli/compare.ts` + `performance:sync`** (local / CI artifact): column-driven native baseline plus library ops/sec and vs-native ratios for the public table in `packages/op/docs/performance.md`.
4. **`cli/profile.ts`** (local): V8 CPU/heap profiling and overhead breakdown when you need to investigate a regression.

## Comparison matrix

Scenario semantics live in [`runtime/comparison-matrix.ts`](runtime/comparison-matrix.ts). Each row defines `implementations` keyed by column id; `native` is the baseline and competitors (`@prodkit/op`, `effect`) run the same workload shape. Add columns by extending `IMPLEMENTATION_COLUMNS` and each scenario's `implementations` map.

| Output | Harness | Purpose |
| --- | --- | --- |
| Public snapshot table | `cli/compare.ts` -> `performance:sync` | User-facing absolute ops/sec and vs-native ratios (native, Op, Effect) |
| CI regression guard | CodSpeed walltime + `overhead.*.ratio` | Track absolute timings and gap changes |
| Sync hot path | CodSpeed simulation (`compose.rawSyncYieldStar`) | Generator dispatch without async noise |
| Deep dive | `cli/profile.ts` | Flame graphs and compose breakdown |

Shared scenario definitions live in `runtime/scenarios.ts`. The comparison matrix, CodSpeed benches, profile harness, and Vitest smoke tests import from there so semantics stay aligned.

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
pnpm --filter @prodkit/benchmarks run calibrate:runner
pnpm --filter @prodkit/benchmarks run compare:refs -- --base=main --candidate=HEAD
pnpm --filter @prodkit/benchmarks run compare:refs -- --base=main --candidate=HEAD --profile-capture=auto
pnpm --filter @prodkit/benchmarks run publish:artifacts -- --report=op/.artifacts/comparison-report.json --dry-run
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

Walltime benches track Op absolute timings plus `overhead.*.ratio` benches that measure Op-vs-native gap drift. Native baselines stay in `cli/compare.ts` for the public table; ratio benches run native work internally without publishing separate CodSpeed series.

### CodSpeed setup (maintainers, one-time)

1. Sign up at [codspeed.io](https://codspeed.io) and import `trvswgnr/prodkit`.
2. Install the CodSpeed GitHub App on the repository.
3. Trigger the CodSpeed workflow on `main` (`workflow_dispatch` or push). CodSpeed backtests to establish baseline data; subsequent PRs get regression comments automatically.

### Public comparison table

`cli/compare.ts` runs the same scenario matrix with `tinybench`, writes `op/.artifacts/comparison-report.json`, and `performance:sync` renders the snapshot block in `packages/op/docs/performance.md`.

To add another competitor column, extend `IMPLEMENTATION_COLUMNS` and each scenario's `implementations` in `runtime/comparison-matrix.ts` (see `runtime/effect-scenarios.ts` for the Effect column). `cli/compare.ts` and `tools/update-op-performance-doc.ts` read column ids from the report automatically. CodSpeed walltime benches stay Op-only.

`compare --pair=op,effect` prints a direct head-to-head table (winner + margin) and stores the same data under `pair` in `op/.artifacts/comparison-report.json`.

### Official report and diff

`compare` and `profile` also write official report metadata into their JSON output. The official
fields include the schema version, run id, runner identity, commit metadata, package version,
dependency fingerprint, benchmark options, scenario-level statistics, variance fields, and artifact
references. Runner identity includes CPU model and logical cores, memory total, operating system
release, Node version, package manager, and the configured runner id. The legacy comparison fields
remain in `comparison-report.json` so `performance:sync` can keep reading the same shape.

Compare two compatible official reports with:

```bash
pnpm --filter @prodkit/benchmarks run report:diff -- base-report.json candidate-report.json
pnpm --filter @prodkit/benchmarks run report:diff -- base-report.json candidate-report.json --implementation=op
```

Diff verdicts use throughput deltas plus each scenario's relative margin of error. Small movements
inside the noise threshold are reported as inconclusive instead of being treated as regressions or
improvements.

`compare:refs` can capture V8 CPU and heap profiles for meaningful candidate deltas. Automatic
selection uses non-inconclusive diff verdicts, ranks scenarios by absolute delta, and profiles one
scenario by default:

```bash
pnpm --filter @prodkit/benchmarks run compare:refs -- \
  --base=main \
  --candidate=HEAD \
  --profile-capture=auto
```

Use `--profile-limit=<count>` to profile more automatically selected scenarios. Use
`--profile-mode=cpu`, `--profile-mode=heap`, or `--profile-mode=both` to choose which profile
artifacts to capture. Use `--profile-scenario=<scenario>` to override automatic selection; the value
can be a comparison key such as `all`, the Op profile scenario such as `all.opAll`, or an overhead
profile scenario such as `overhead.all.ratio`.

Captured profile files are attached to the candidate scenario results in the trusted comparison
report. Publishing that report uploads the profile artifacts and the history API exposes their object
keys from the candidate run detail and scenario history.

### Publishing official artifacts

`publish:artifacts` uploads official benchmark reports and referenced profile artifacts to
Cloudflare R2. The command is explicit: `compare`, `profile`, and `compare:refs` never publish by
themselves. Run it only from trusted maintainer workflows or local sessions that already produced an
official report.

Dry-run mode validates the report, derives object keys, prints the planned manifest, and makes no
Cloudflare request:

```bash
pnpm --filter @prodkit/benchmarks run publish:artifacts -- --report=op/.artifacts/comparison-report.json --dry-run
pnpm --filter @prodkit/benchmarks run publish:artifacts -- --report=op/.artifacts/trusted-ref-comparison-report.json --dry-run
```

Upload mode writes `op/.artifacts/benchmark-publish-manifest.json` only after every object upload
succeeds. Failed uploads leave no completed manifest, so later index work can treat the manifest as
the "fully published" marker.

```bash
pnpm --filter @prodkit/benchmarks run publish:artifacts -- --report=op/.artifacts/comparison-report.json
```

The publisher reads these environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `PRODKIT_BENCHMARK_R2_BUCKET` | Yes | Destination R2 bucket |
| `PRODKIT_BENCHMARK_R2_ACCOUNT_ID` | Yes, unless `PRODKIT_BENCHMARK_R2_ENDPOINT` is set | Builds the default R2 S3 endpoint |
| `PRODKIT_BENCHMARK_R2_ENDPOINT` | Optional | Overrides the default `https://<account>.r2.cloudflarestorage.com` endpoint |
| `PRODKIT_BENCHMARK_R2_PREFIX` | Optional | Prefix prepended to every object key |
| `PRODKIT_BENCHMARK_R2_ACCESS_KEY_ID` | Upload only | R2 S3 access key id |
| `PRODKIT_BENCHMARK_R2_SECRET_ACCESS_KEY` | Upload only | R2 S3 secret access key |

Dry-run mode requires the bucket and endpoint inputs, but not the access key or secret.

Use an R2 token scoped to the benchmark bucket and configured prefix with object write permission.
Do not expose the token to untrusted pull request code. In GitHub Actions, keep publish steps on
protected scheduled, manual, or protected-branch workflows rather than `pull_request` jobs that run
contributor code.

Object keys are derived from official run metadata:

```text
<prefix>/official/<run-kind>/<run-id>/run/report/<filename>
<prefix>/official/<run-kind>/<run-id>/scenario/<scenario-key>/<implementation-id>/<artifact-kind>/<filename>
```

Additional profile files can be attached when they are not already referenced by a report:

```bash
pnpm --filter @prodkit/benchmarks run publish:artifacts -- \
  --report=.profiles/op/profile.json \
  --artifact=kind=cpu-profile,path=.profiles/op/CPU.example.cpuprofile,scenario=compose.opYieldChain,implementation=op \
  --dry-run
```

### Benchmark history API

`history/benchmark-history-api.ts` is a Cloudflare Worker entry for indexing official benchmark metadata
after artifacts are uploaded. Raw reports and profiles remain the durable source in R2. The API
stores only compact query data for latest runs, run details, scenario history, comparison summaries,
and published artifact object keys.

Configure the Worker with:

| Binding or secret | Required | Purpose |
| --- | --- | --- |
| `PRODKIT_BENCHMARK_HISTORY` | Yes | Cloudflare KV namespace for the compact metadata index |
| `PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN` | Yes for writes | Shared secret accepted from trusted runner workflows only |
| `PRODKIT_BENCHMARK_ARTIFACT_BASE_URL` | Optional | Public base URL used by the dashboard to link published R2 artifact object keys |

The trusted runner posts an uploaded manifest and the report it just published:

```bash
curl -X POST "$PRODKIT_BENCHMARK_HISTORY_API/api/benchmarks/index" \
  -H "authorization: Bearer $PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN" \
  -H "content-type: application/json" \
  --data @payload.json
```

`payload.json` has this shape:

```json
{
  "manifest": "<benchmark-publish-manifest.json contents>",
  "report": "<official or trusted comparison report contents>"
}
```

Only upload manifests are accepted. Dry-run manifests are rejected so the index cannot point at
artifacts that were never published. Reposting the same run is idempotent because run and comparison
ids replace existing index entries.

Read endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/benchmarks/latest?kind=comparison` | Latest indexed official run summary |
| `GET /api/benchmarks/runs/<run-id>` | Run metadata, scenarios, benchmark options, and artifact object keys |
| `GET /api/benchmarks/scenarios/<scenario-key>/history?implementation=op&limit=20` | Recent scenario trend data |
| `GET /api/benchmarks/comparisons?limit=20` | Trusted base/candidate comparison summaries and delta verdicts |

Keep the write token out of pull request jobs that run untrusted code. The token belongs only in
protected scheduled, manual, or protected-branch workflows that already have permission to publish
official artifacts.

The same Worker also serves the benchmark history dashboard from `/`, `/runs/<run-id>`, and
`/scenarios/<scenario-key>`. The dashboard reads the API routes above, shows the latest official
run, trusted base/candidate verdicts, run metadata, scenario trends, calibration context, and raw
artifact links when `PRODKIT_BENCHMARK_ARTIFACT_BASE_URL` is configured.

Run the dashboard locally with seeded mock data:

```bash
pnpm --filter @prodkit/benchmarks run dashboard:mock
pnpm --filter @prodkit/benchmarks run dashboard:mock -- --port=4176
```

Deploy the same dashboard and API as a public Cloudflare Worker:

```bash
pnpm --filter @prodkit/benchmarks exec wrangler kv namespace create PRODKIT_BENCHMARK_HISTORY
pnpm --filter @prodkit/benchmarks run dashboard:deploy -- --dry-run --kv-namespace-id=<namespace-id>
pnpm --filter @prodkit/benchmarks exec wrangler secret put PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN --config op/.artifacts/wrangler.json
pnpm --filter @prodkit/benchmarks run dashboard:deploy -- --kv-namespace-id=<namespace-id>
```

The deploy script writes an account-specific Wrangler config under `benchmarks/op/.artifacts/`
before invoking Wrangler, so Cloudflare namespace ids stay out of git. The `--dry-run` path asks
Wrangler to bundle and validate the Worker without publishing it. The Worker is published on a
`workers.dev` URL by default. Use that URL as `PRODKIT_BENCHMARK_HISTORY_API` for the official
runner. Set `PRODKIT_BENCHMARK_ARTIFACT_BASE_URL` before deploy when the R2 bucket has a public
artifact origin. The generated config enables Cloudflare `nodejs_compat` because the history API
shares schema modules with Node-maintainer scripts.

### Trusted official runner

The official runner workflow lives in
[`.github/workflows/official-benchmarks.yml`](../../.github/workflows/official-benchmarks.yml). It
uses `cli/official-runner.ts` to apply the trusted-run policy, create the report, publish artifacts, and
update the history index.

Trusted-run policy:

| Run kind | Trigger | Allowed refs | Approval value |
| --- | --- | --- | --- |
| Scheduled baseline | `schedule` | `main` only | `scheduled-baseline` |
| Manual baseline | `workflow_dispatch` | Maintainer-selected base ref | `manual-baseline` |
| Manual candidate comparison | `workflow_dispatch` | Maintainer-selected base and candidate refs | `manual-candidate-comparison` |

Pull request events are not accepted for official publishing. Candidate comparison code runs in the
benchmark job without Cloudflare credentials. The publish job downloads the report artifact, receives
the R2 and history API secrets, uploads the completed report, and posts it to the history index. The
workflow has one concurrency group with `cancel-in-progress: false`, so official runs execute one at
a time.

Manual candidate comparisons calibrate the runner before measuring refs, require that calibration
summary in the official report, and run the trusted comparison with `--time=1000 --repeats=5`.
This keeps public verdicts tied to the runner's observed same-code noise band instead of a single
short Tinybench sample.

Trusted ref reports also record a SHA-256 fingerprint of the built `@prodkit/op` runtime files. When
base and candidate runtime fingerprints are identical, directional verdicts are suppressed and every
scenario is reported as inconclusive, while the measured deltas remain in the report for diagnostics.

Required repository configuration:

| Name | Kind | Purpose |
| --- | --- | --- |
| `PRODKIT_BENCHMARK_R2_BUCKET` | Variable | Destination R2 bucket |
| `PRODKIT_BENCHMARK_R2_ACCOUNT_ID` | Variable | Builds the default R2 endpoint when no endpoint override is set |
| `PRODKIT_BENCHMARK_R2_ENDPOINT` | Variable, optional | Overrides the default R2 endpoint |
| `PRODKIT_BENCHMARK_R2_PREFIX` | Variable, optional | Prefix prepended to uploaded object keys |
| `PRODKIT_BENCHMARK_HISTORY_API` | Variable | Base URL of the benchmark history Worker |
| `PRODKIT_BENCHMARK_ARTIFACT_BASE_URL` | Variable, optional | Public origin for dashboard raw artifact links |
| `PRODKIT_BENCHMARK_RUNNER_ID` | Variable, optional | Runner id recorded in official reports |
| `PRODKIT_BENCHMARK_R2_ACCESS_KEY_ID` | Secret | R2 S3 access key id |
| `PRODKIT_BENCHMARK_R2_SECRET_ACCESS_KEY` | Secret | R2 S3 secret access key |
| `PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN` | Secret | Bearer token for history index writes |

The same runner can be exercised locally, but local publish mode uses real Cloudflare credentials:

```bash
pnpm --filter @prodkit/benchmarks run official -- run --kind=baseline --approval=manual-baseline --event=workflow_dispatch --base=main
pnpm --filter @prodkit/benchmarks run official -- publish
```

Candidate comparison runs profile the largest meaningful delta by default. Maintainers can disable
that with `--profile-capture=off`, limit the capture to one mode with `--profile-mode=cpu` or
`--profile-mode=heap`, or force a specific scenario with `--profile-scenario=<scenario>`. The
official workflow exposes the same inputs. Profile artifacts are uploaded with the report artifact
from the benchmark job so the publish job can push them to R2 and index their object keys.

Failure recovery:

- If the benchmark job fails, no official data was published. Fix the runner or ref selection and
  dispatch the workflow again.
- If publish fails before the manifest is written, rerun the workflow or rerun the `publish` stage
  with the saved report artifact after fixing credentials, bucket policy, or network configuration.
- If R2 upload succeeds but history indexing fails, keep the uploaded report as the source of truth
  and rerun the `publish` stage with the same report artifact after fixing
  `PRODKIT_BENCHMARK_HISTORY_API` or `PRODKIT_BENCHMARK_HISTORY_WRITE_TOKEN`.
- If a candidate comparison used the wrong refs, dispatch a new manual candidate comparison. Do not
  edit indexed run data by hand.

### Runner calibration

Calibrate an official runner before trusting optimization decisions from it:

```bash
pnpm --filter @prodkit/benchmarks run calibrate:runner
pnpm --filter @prodkit/benchmarks run calibrate:runner -- --samples=5 --time=1000 --repeats=3
```

Calibration runs equivalent left/right measurements of the Op comparison scenarios on the same
package build. It alternates which side runs first, summarizes the observed per-scenario noise band,
and recommends whether the runner is stable enough for microbenchmark and workflow benchmark
decisions. The default thresholds are 5% for microbenchmarks and 10% for workflow decisions. Treat a
`noisy` recommendation as a runner problem first: stop other heavy processes, use power and thermal
settings that keep CPU frequency stable, rerun calibration, and avoid publishing official verdicts
from that machine until the relevant recommendation is `acceptable`.

Attach the latest calibration summary to official reports with `--calibration`:

```bash
pnpm --filter @prodkit/benchmarks run compare -- --calibration=op/.artifacts/runner-calibration-report.json
pnpm --filter @prodkit/benchmarks run profile -- --calibration=op/.artifacts/runner-calibration-report.json
pnpm --filter @prodkit/benchmarks run compare:refs -- --base=main --candidate=HEAD --calibration=op/.artifacts/runner-calibration-report.json
```

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

Measurement matches the compare harness (`pnpm run build:size` / `cli/compare.ts`). Fork PRs cannot receive comments (GitHub permission model); the job still prints the comparison to stdout.

## Profiling sequential composition

CodSpeed reports end-to-end scenario timings. The profile harness decomposes the compose path into comparable scenarios and reports `tinybench` statistics (mean, min/max, standard error, relative margin of error).

```bash
pnpm --filter @prodkit/op run build
pnpm --filter @prodkit/benchmarks run profile
pnpm --filter @prodkit/benchmarks run profile -- --report=.profiles/op/profile.json
pnpm --filter @prodkit/benchmarks run profile -- --time=1000 --repeats=3
pnpm --filter @prodkit/benchmarks run profile -- --steps=12
```

When CodSpeed flags a regression, use `cli/profile.ts` for deep investigation. The profile registry
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
- Use `cli/profile.ts` after a CodSpeed regression to isolate overhead sources.
- Keep scenario semantics aligned between `runtime/comparison-matrix.ts`, `runtime/scenarios.ts`, CodSpeed benches, and `cli/profile.ts` when adding or changing workloads.
