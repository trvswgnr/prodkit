# Relationship to better-result

`@prodkit/op` uses [`better-result`](https://github.com/dmmulroy/better-result) for the result
boundary: `Result`, `TaggedError`, `UnhandledException`, typed error inference, and result-level
helpers. It keeps `better-result` as a peer dependency so your app installs one copy and TypeScript
sees the same result types that `.run()` returns.

`@prodkit/op` 1.x requires `better-result ^3.0.1`.

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

Version 3 tagged errors do not use the trailing factory call from 2.x:

```ts
class RequestFailed extends TaggedError("RequestFailed")<{
  cause: unknown;
  message: string;
}> {}
```

## Retry and cancellation boundary

`better-result` 3 can own retry for one async action. `Result.tryPromise` provides a one-based
`attempt` to each try and retry callback, passes the configured `AbortSignal` through their context,
and interrupts a pending retry delay when that signal aborts. It supports bounded retries, retry
predicates, static backoff with jitter, and error-dependent delays.

```ts
const result = await Result.tryPromise(
  {
    try: ({ signal }) => fetch("/api/user", { signal }),
    catch: (cause) => new RequestFailed({ cause, message: "User request failed" }),
  },
  {
    signal: request.signal,
    retry: {
      times: 2,
      delayMs: (_error, { attempt }) => attempt * 100,
      shouldRetry: (_error, { attempt }) => attempt < 3,
    },
  },
);
```

This is enough when the retry budget belongs to that action. Forward the context signal to the
underlying API, as the `fetch` example does; `Result.tryPromise` cannot cancel an arbitrary promise
that ignores it.

Use `Policy.retry` when the retry budget belongs to an Op run and must compose with other execution
semantics:

- Attachment order lets `Policy.timeout` wrap the whole retry loop or each attempt.
- One run signal reaches nested operations; `Op.all`, `Op.any`, and `Op.race` can interrupt and drain
  sibling work after the result is decided.
- `Op.defer`, `.on("exit")`, and `Policy.release` finalizers finish before the run settles.
- DI scopes and child operations share the same run context.
- Lazy operations compose first and begin only at `.run(...)`.

Avoid wrapping the same effect in both retry layers unless you intentionally want nested retry
budgets.
