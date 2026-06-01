# @prodkit/op guides

Extended documentation for `@prodkit/op`. These files ship in the npm tarball alongside
[`README.md`](../README.md) (hub + core API) and [`DESIGN.md`](../DESIGN.md) (execution invariants).

| Guide | Topic |
| --- | --- |
| [comparison.md](comparison.md) | Tradeoffs vs Promise, neverthrow, fp-ts, Effect |
| [performance.md](performance.md) | Benchmark snapshot, bundle size, regression tooling |
| [di.md](di.md) | `@prodkit/op/di` tokens, provide/inject, token identity, runtime errors |
| [policy.md](policy.md) | `@prodkit/op/policy` attachments, exports, ordering with core |
| [hkt.md](hkt.md) | `@prodkit/op/hkt` encoding and custom `Policy.define` checklist |
| [internal.md](internal.md) | `@prodkit/op/internal` extension surface |
| [lifecycle.md](lifecycle.md) | `Op.defer`, release, enter/exit hooks, finalizer ordering |
| [cancellation.md](cancellation.md) | Cooperative cancellation contract and composed-run wiring |

Monorepo decision records: [`docs/adr/`](../../../docs/adr/).
