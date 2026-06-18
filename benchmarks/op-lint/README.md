# op-lint benchmarks

This directory tracks `@prodkit/op-lint` performance. The rule runs in an Oxlint JavaScript-plugin
path for consumers, but the benchmark suite also exercises the ESLint-compatible rule in-process so
V8 CPU and heap profiles point at the detector and rule code instead of a parent process waiting on
a child linter.

## Commands

From the repo root:

```bash
pnpm --filter @prodkit/op-lint run build
pnpm --filter @prodkit/benchmarks run codspeed:bench:walltime
pnpm --filter @prodkit/benchmarks run profile:op-lint
pnpm --filter @prodkit/benchmarks run profile:op-lint:cpu -- --scenario=op-lint.requireYieldStar.typeAwareWarmProject
pnpm --filter @prodkit/benchmarks run profile:op-lint:heap -- --scenario=op-lint.requireYieldStar.typeAwareWarmProject
```

Profiler JSON, CPU, and heap outputs go under `.profiles/op-lint/` (gitignored).

## Scenarios

| Scenario | What it isolates |
| --- | --- |
| `op-lint.requireYieldStar.directBuilders` | Direct `Op.*` builder calls in generator bodies. Tracks rule traversal and detector setup on simple files. |
| `op-lint.requireYieldStar.typeAwareWarmProject` | Type-aware detection after the TypeScript project and source-file index are cached. Best default for CPU flame graphs. |
| `op-lint.requireYieldStar.typeAwareColdProject` | Rotating files outside the tsconfig include set. Forces TypeScript project cache churn and catches cold-path regressions. |
| `op-lint.requireYieldStar.oxlintCliProject` | Full Oxlint JavaScript-plugin walltime on a generated project. Useful for bridge and process-level regressions, not V8 flame graphs. |

Use the in-process scenarios for CPU and heap profiles. Use the Oxlint CLI scenario when the
question is end-to-end walltime or plugin loading behavior.

## Guidance

- Keep direct-builder and type-aware scenarios separate; otherwise TypeScript program work hides
  cheap AST traversal costs.
- Treat CodSpeed as the regression signal. Local walltime is useful for debugging but should not set
  baselines.
- Keep generated fixture sizes modest. The goal is stable comparative signal, not a synthetic large
  repository benchmark.
