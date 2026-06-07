# Op examples

Runnable `@prodkit/op` samples. Each topic folder has `sample.ts` (the program) and `smoke.ts`
(assertions). `smoke.ts` at this level aggregates all topic smokes.

| Topic | Sample | What it shows |
| --- | --- | --- |
| `core/` | (smoke only) | Retry, timeout, and `Op.try` error channels |
| `simple/` | [`sample.ts`](simple/sample.ts) | Basic composition, `Op.try`, polling, cancellation |
| `webhook/` | [`sample.ts`](webhook/sample.ts) | Validation, combinators, policies, abort propagation |
| `defer-resource/` | [`sample.ts`](defer-resource/sample.ts) | `Op.defer` and scoped resource cleanup |
| `cancel-propagation/` | [`sample.ts`](cancel-propagation/sample.ts) | Nested `Op.all` and cooperative cancellation |
| `queue-consumer/` | [`sample.ts`](queue-consumer/sample.ts) | Batched polling, concurrency cap, graceful shutdown |
| `custom-policy/` | [`sample.ts`](custom-policy/sample.ts) | Custom `Policy.define` with HKT |
| `comparison/` | [`complexity.ts`](comparison/complexity.ts) | Read-only plain TS vs Op comparison (not in smoke) |

DI samples live under [`di/`](di/README.md).
