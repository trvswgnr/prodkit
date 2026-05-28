# Benchmarks

This harness exists to answer two questions:

1. Did this branch regress vs the latest commit on `main`?
2. How does this branch compare to the latest published npm release?

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
- Use `--report=<path>` to write machine-readable results (`overhead.*.slowdownRatio`, runtime hz, bundle size). CI uploads this as the `op-benchmarks` artifact; see [`BENCHMARKS.md`](../../BENCHMARKS.md).
- Refresh the public performance snapshot with `pnpm --filter @prodkit/tools run performance:sync -- --write` after generating `report.json`.

## Contributor guidance

- Treat all numbers as directional and machine-dependent.
- Compare runs on the same machine and similar background load.
- Focus on relative deltas more than absolute ops/sec.
- If a regression appears, rerun once before concluding.
- Keep benchmark scenario semantics equivalent when adding/changing tests.
