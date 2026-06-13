# Lifecycle and finalizers

Resource cleanup, success-gated release, and run boundary hooks share one LIFO finalizer stack per
run. If a registered finalizer throws after the body settles, that fault becomes the observable
`Err(UnhandledException)`, even when the body already succeeded or failed with a typed error.

## `Op.defer(finalize)`

Registers cleanup for the **current** op run inside a generator. **`finalize(ctx)`** receives
**`ExitContext`**: the run `AbortSignal`, runtime **`args`**, plus **`result`**: the operation's
pre-finalizer settlement result (from `better-result`).

Deferred callbacks share one stack with `.with(Policy.release(...))` and `.on("exit", ...)`: they run
in **LIFO** order when the run unwinds (success, typed failure, `UnhandledException`, timeout, or
external cancellation). **All** scheduled finalizers run; even if one throws, the **remaining**
callbacks in the stack **still run**.

If any finalizer throws, `.run()` returns `Err(UnhandledException)` with `cause` set to an
`ErrorGroup` whose message is `Operation cleanup failed`. The group preserves exact thrown values
without requiring them to be `Error` instances. If the body had already failed, its error is the
first entry. Cleanup failures follow in finalizer execution order, which is LIFO registration order.
A successful body contributes no entry. The same group shape is used for one or many cleanup
failures. `finalize` can be sync or async.

Use `Op.defer` / `.with(Policy.release(...))` / `.on("exit", ...)` for effectful cleanup. Native
generator `finally` blocks are only best-effort synchronous finalization; yielded or async work
inside `finally` is not driven during early exit. Register defer **before** risky steps:

```ts
// Anti-pattern: yield* in finally is not driven on early exit.
const leaky = Op(function* () {
  try {
    return yield* Op.fail("boom");
  } finally {
    yield* Op.defer(() => cleanup()); // does not run
  }
});

// Preferred: register cleanup before the step that can fail.
const scoped = Op(function* () {
  yield* Op.defer(() => cleanup());
  return yield* Op.fail("boom");
});
```

`Policy.release` invokes only `release(successValue)` (no context parameter); its stack slot receives
the same **`ExitContext`** as other finalizers for this run, but the release function ignores it.

```ts
const runQuery = Op(function* () {
  const conn = yield* acquireConnection;
  yield* Op.defer(() => conn.release());
  return yield* getActiveUsers(conn);
});
```

`Op.defer` is only meaningful inside an `Op(function* () { ... })` body. For releasing the **success
value** of a single op, `.with(Policy.release(...))` on that op is often clearer.

## `.with(Policy.release(release))`

Registers resource release logic that runs after a successful resource-producing step settles.

```ts
import { Policy } from "@prodkit/op/policy";

const runQuery = Op(function* () {
  const conn = yield* acquireDbConnection.with(Policy.release((conn) => conn.release()));
  return yield* getActiveUsers(conn);
});

const result = await runQuery.with(Policy.timeout(1000)).run();
// conn.release() runs even if the run times out or is externally aborted.
```

`release` can be sync or async. `Policy.release` only schedules `release` after the wrapped op
**succeeds**. If `release` throws, the run fails with `UnhandledException` (other finalizers still
run afterward in LIFO order).

## `.on("exit", finalize)` and `.on("enter", initialize)`

**Exit:** unconditional finalization when the enclosing run settles. **`finalize(ctx)`** receives
**`ExitContext`** with run `args` and the pre-finalizer **`ctx.result`**.

```ts
const result = await doWork.on("exit", (ctx) => telemetry.record(ctx)).run();
```

**Enter:** run-start initialization before the wrapped op body is driven. `initialize(ctx)` receives
`EnterContext` with the run `signal` and runtime `args`.

```ts
const result = await doWork
  .on("enter", ({ signal, args }) =>
    telemetry.startSpan({ aborted: signal.aborted, key: String(args[0]) }),
  )
  .on("exit", (ctx) => telemetry.finishSpan({ args: ctx.args, result: ctx.result }))
  .run();
```

Ordering:

- Enter handlers run in wrapper order (last chained runs first).
- Exit handlers keep the current unwind ordering.
- Enter handlers run once per wrapper run; retry runs happen inside that wrapper regardless of
  whether `.with(Policy.retry(...))` is chained before or after `.on("enter", fn)`.
