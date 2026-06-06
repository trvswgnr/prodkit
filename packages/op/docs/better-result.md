# Relationship to better-result

`@prodkit/op` uses [`better-result`](https://github.com/dmmulroy/better-result) for the result
boundary: `Result`, `TaggedError`, `UnhandledException`, typed error inference, and result-level
helpers. It keeps `better-result` as a peer dependency so your app installs one copy and TypeScript
sees the same result types that `.run()` returns.

Import result primitives from `better-result`. Import operation APIs from `@prodkit/op` and its
subpaths.

```ts
import { Op } from "@prodkit/op";
import { Policy } from "@prodkit/op/policy";
import { Result, TaggedError, UnhandledException } from "better-result";
```

Most `better-result` symbols are part of the public contract, but they are not re-exported from
`@prodkit/op`. Split imports keep ownership clear: `better-result` owns result primitives and their
release surface; `@prodkit/op` owns async execution, cancellation-aware combinators, lifecycle
hooks, and policy attachment.

## Retry boundary

Use `better-result` helpers when you only need result-level composition. Use `Policy.retry` when the
retry budget belongs to an operation run.

Operation-level retry composes with the rest of the `Op` runtime:

- `Policy.timeout` can wrap the whole retry loop or each attempt, depending on `.with(...)` order.
- `Policy.cancel` can stop retry delay and in-flight attempts through the run signal.
- `Op.defer`, `.on("exit")`, and `Policy.release` finalizers still run before settlement.
- `Op.all`, `Op.any`, and `Op.race` can abort sibling work when the result is decided.

Avoid wrapping the same effect in both retry layers unless you intentionally want nested retry
budgets.
