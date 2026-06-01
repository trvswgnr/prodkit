# @prodkit/op

A runtime-agnostic, composable, and predictable library for writing operations in TypeScript, built on top of [`better-result`](https://github.com/dmmulroy/better-result).

This README is the **hub**: installation, quick start, and core API reference. Extended guides for
subpaths, lifecycle, and cancellation live in [`docs/`](docs/README.md) and ship in the npm tarball.
See also [`DESIGN.md`](DESIGN.md) (execution invariants), [docs/comparison.md](docs/comparison.md),
[docs/performance.md](docs/performance.md), and monorepo [`docs/CONTEXT.md`](https://github.com/trvswgnr/prodkit/blob/main/docs/CONTEXT.md).

> [!WARNING]
> This library is currently in alpha. The API will almost certainly change between releases while it stabilizes.

> [!NOTE]
> Subpath exports (`@prodkit/op/di`, `@prodkit/op/policy`, `@prodkit/op/hkt`, `@prodkit/op/internal`)
> ship with the matching npm release. If your installed version predates a subpath, upgrade
> `@prodkit/op` or import only what that version's `package.json` `exports` lists. This repo's
> `main` branch may document APIs still under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md)
> until they are published.

Compose steps top-to-bottom, attach retry, timeout, and cancellation as policy, and run parallel
work without scattering reliability logic across your app.

## Contents

- [Why this exists](#why-this-exists)
- [Installation](#installation)
- [Dependencies (`better-result`)](#dependencies-better-result)
- [Subpath exports](#subpath-exports)
- [Quick start](#quick-start)
- [Core API](#core-api)
- [Typed errors](#typed-errors)
- [Retry defaults](#retry-defaults)
- [Built-in errors](#built-in-errors)
- [Concurrent combinators](#concurrent-combinators)
- [Examples](#examples)
- [Performance](#performance)
- [Contributing](#contributing)

## Why this exists

Async TypeScript has two huge flaws: you can't see from a function's type what it might fail with, and the standard concurrency helpers happily let sibling tasks keep running after one of them blows up. `@prodkit/op` fixes both. It builds on `better-result`'s `Result` model, generator composition, and typed error inference, then adds an async runtime with suspend/resume semantics, structured resource cleanup, cancellation-aware concurrency, and composable retry/timeout policies on top. Concurrency combinators thread cancellation through every child, so when one fails the rest actually stop instead of burning quota in the background. Retry, timeout, and external cancellation attach through `.with(Policy.*)` before `.run()`. Minimal runtime dependencies, a small footprint, and an API that's easy to learn and use.

## Installation

```bash
npm i @prodkit/op
```

Runtime support: any JavaScript runtime with `Promise` and `AbortController`. No Node-specific APIs
are required by the public operation model.

## Dependencies (`better-result`)

`@prodkit/op` declares `better-result` as a peer dependency so your app installs one copy and
TypeScript resolves the same `Result` types that `.run()` returns.

```json
"better-result": "^2.9.0"
```

Install it alongside `@prodkit/op` when your package manager does not install peers automatically.

Most `better-result` symbols are part of the public contract but are **not** re-exported from
`@prodkit/op`. Import them from `better-result`; import operation APIs from `@prodkit/op`.

From **`better-result`**: `Result`, `TaggedError`, `UnhandledException`, `TaggedErrorInstance`,
and optional advanced helpers (`Err`, `Ok`, `InferErr`).

From **`@prodkit/op`**: `TimeoutError` (from `.with(Policy.timeout(...))`), `ErrorGroup` (from
`Op.any` when every branch fails).

## Subpath exports

Op-native extensions ship as separate subpath exports. The main `@prodkit/op` entry does not
re-export them ([ADR 0008](https://github.com/trvswgnr/prodkit/blob/main/docs/adr/0008-op-subpath-exports.md)
in the monorepo).

| Subpath | Guide |
| --- | --- |
| `@prodkit/op/di` | [docs/di.md](docs/di.md) |
| `@prodkit/op/policy` | [docs/policy.md](docs/policy.md) |
| `@prodkit/op/hkt` | [docs/hkt.md](docs/hkt.md) |
| `@prodkit/op/internal` | [docs/internal.md](docs/internal.md) |

Also see [docs/lifecycle.md](docs/lifecycle.md) (defer, release, enter/exit) and
[docs/cancellation.md](docs/cancellation.md) (cooperative abort contract). Full index:
[docs/README.md](docs/README.md).

Minimal policy attach:

```ts
import { Op } from "@prodkit/op";
import { Policy } from "@prodkit/op/policy";

await Op.try(() => fetch("https://example.com")).with(Policy.timeout(1_000)).run();
```

## Quick start

```ts
import { Op } from "@prodkit/op";
import { TaggedError } from "better-result";

class DivisionByZeroError extends TaggedError("DivisionByZeroError")() {}

const divide = Op(function* (a: number, b: number) {
  if (b === 0) return yield* new DivisionByZeroError();
  return a / b;
});

const sqrt = Op(function* (n: number) {
  if (n < 0) return yield* Op.fail("Negative");
  return Math.sqrt(n);
});

const program = Op(function* () {
  const quotient = yield* divide(10, 2);
  const rooted = yield* sqrt(quotient);
  return rooted * 2;
});

const result = await program.run();
if (result.isOk()) {
  console.log(result.value);
} else {
  console.error(result.error);
}
```

## Core API

### `Op(fn)`

Turns a generator into a composable operation. Inside the generator, `yield*` another op to unwrap
success or short-circuit on failure. Parameterized ops must be invoked before composition:
`yield* loadUser(id)`, not `yield* loadUser`.

### `Op.of(value)` / `Op.fail(error)` / `Op.empty`

`Op.of` succeeds with `value` (awaiting promises into the same `Result` model). `Op.fail` always
fails with `error`. `Op.empty` is a reusable no-op that succeeds with `void`.

### `Op.defer(finalize)` / `.on("exit")` / `.on("enter")` / `.with(Policy.release)`

Registers cleanup or run-boundary hooks on a shared LIFO finalizer stack. Use these instead of
`yield*` inside generator `finally` blocks (async/yield cleanup in `finally` is not driven on early
exit).

```ts
const runQuery = Op(function* () {
  const conn = yield* acquireConnection;
  yield* Op.defer(() => conn.release());
  return yield* getActiveUsers(conn);
});
```

Finalizer ordering, anti-patterns, enter/exit semantics, and release policy details:
[docs/lifecycle.md](docs/lifecycle.md).

### `Op.sleep(ms)`

Waits for `ms` milliseconds then succeeds with `void`. Negative durations normalize to `0`;
non-finite durations fail at run time with `UnhandledException`. Observes surrounding cancellation.

### Sleep vs timeout input validation

Both validate at run time, not at attach time. Invalid values settle to `Err(UnhandledException)`
with the validation error as `cause`.

| Input | Negative | Non-finite |
| --- | --- | --- |
| `Op.sleep(ms)` | Normalized to `0` | `Err(UnhandledException)` |
| `Policy.timeout(timeoutMs)` | `Err(UnhandledException)` | `Err(UnhandledException)` |

See [`DESIGN.md`](DESIGN.md#invariant-input-normalization-and-validation-at-run-time) for the full table.

### `Op.try(f, onError?)`

Runs a sync or async function and converts failures into `Err`. `f` receives an `AbortSignal`; pass
it to cancellable APIs. See [docs/cancellation.md](docs/cancellation.md).

```ts
import { Policy } from "@prodkit/op/policy";

const fetchUser = Op.try((signal) => fetch("/api/users/1", { signal }));
const result = await fetchUser.with(Policy.timeout(1000)).run();
```

If `onError` is omitted, failures become `UnhandledException`. If `onError` returns an `Op`/generator
object, `Op.try` treats that object as the error value and does not run it.

### `Op.run(op, ...args)` / `.run(...args)`

Executes the operation and returns `Result<T, E | UnhandledException>`. Tuple args bind at the
shell; they are not a cancellation or policy options bag. For external cancellation, compose
`.with(Policy.cancel(signal))` before `.run()`.

### `.map(f)` / `.flatMap(f)`

Value transform and monadic bind. Error channels and argument lists are preserved.

### `.tap(f)` / `.tapErr(f)`

Observe success or typed failure without changing the carried value or error. Return values from `f`
are ignored; returned ops are not run. Use `yield*` in a generator to run another op from a callback.
`UnhandledException` bypasses `tapErr`.

### `.mapErr(f)` / `.recover(predicate, handler)`

Transform typed errors or recover from selected failures. `UnhandledException` bypasses both.
`recover` treats handler return values as fallback data; use `flatMap` or `yield*` to run another op.

### `.with(policy)`

Attaches retry, timeout, cancel, release, or custom policy before `.run()`. Import built-in policies
from `@prodkit/op/policy`.

```ts
import { Policy } from "@prodkit/op/policy";

const policy = { retries: 2, when: () => true, delay: (retry: number) => (retry + 1) * 100 };

// timeout applies to the ENTIRE retried run
const totalBudget = Op.try(() => fetch("https://example.com"))
  .with(Policy.retry(policy))
  .with(Policy.timeout(5000));

// timeout applies to each attempt inside the retry loop
const perAttempt = Op.try(() => fetch("https://example.com"))
  .with(Policy.timeout(5000))
  .with(Policy.retry(policy));
```

Invalid retry shapes and invalid timeout values fail at run time as `Err(UnhandledException)`.
Policy export list and custom `Policy.define` HKT checklist: [docs/policy.md](docs/policy.md) and
[docs/hkt.md](docs/hkt.md).

### Cancellation

Cancellation is cooperative: the runtime propagates `AbortSignal`; your `Op.try` callbacks and
cancellable dependencies must observe it. Combinators abort siblings and wait for settlement;
finalizers still run on timeout or external cancel. Full contract:
[docs/cancellation.md](docs/cancellation.md).

## Typed errors

Use `TaggedError("Name")` for discriminated domain errors. Fail with `yield* new MyError()` inside
an op.

```ts
import { TaggedError } from "better-result";

class ValidationError extends TaggedError("ValidationError")<{ field: string }>() {}

const validate = Op(function* (name: string) {
  if (name.trim().length === 0) {
    yield* new ValidationError({ field: "name", message: "Name is required" });
  }
  return name;
});
```

## Retry defaults

`.with(Policy.retry())` with no policy uses `retries: 2`, `when: () => true`, and exponential
backoff from `1000ms` up to `30000ms` with full jitter. Build custom delays with `Delay.fixed(ms)`
or `Delay.exponential({ baseMs, maxMs, jitter })` from `@prodkit/op/policy`. The `delay(retry, cause)`
callback receives a 0-based retry index (`0` after the first failure).

## Built-in errors

- `UnhandledException`: unmapped throws/rejects and runtime faults.
- `TimeoutError`: from `.with(Policy.timeout(timeoutMs))`.
- `ErrorGroup`: from `Op.any` when all children fail (`errors` in input order).
- Multiple finalizer faults fold into a nested `Error.cause` chain (LIFO unwind order).

## Concurrent combinators

When a result is decided early, remaining work is cancelled through `AbortSignal`. `Op.all`, `Op.any`,
and `Op.race` interrupt aborted losers at suspend boundaries; `Op.allSettled` relies on cooperative
cancel only.

### `Op.all(ops, concurrency?)`

Concurrent run; succeeds with a tuple of values. Fails fast; waits for aborted siblings to settle.
Optional positive `concurrency` caps active children.

### `Op.allSettled(ops, concurrency?)`

Waits for every op; returns a tuple of `Result`s in input order. Does not short-circuit on failure.

### `Op.settle(op)`

Runs one op and returns its `Result` as a success value (never fails the outer op).

### `Op.any(ops)` / `Op.race(ops)`

`Op.any`: first success wins; all failures yield `ErrorGroup`. `Op.race`: first settler wins
(success or failure). Empty `Op.race([])` fails with `UnhandledException`.

```ts
import { ErrorGroup } from "@prodkit/op";

const r = await Op.any([Op.fail("a"), Op.of(69)]).run();
if (r.isErr() && r.error instanceof ErrorGroup) console.log(r.error.errors);
```

## Examples

- [`examples/op/simple.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/simple.ts): minimal composition.
- [`examples/op/webhook.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/webhook.ts): full pipeline (validation, `Op.all`/`Op.any`/`Op.race`, policies, abort).
- [`examples/op/di/`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/di/): DI onboarding, cancellation, HTTP handler.
- [`examples/op/custom-policy.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/custom-policy.ts): custom `Policy.define` with HKT.

## Performance

Microbenchmark overhead vs raw `Promise` is documented in [docs/performance.md](docs/performance.md). Real
apps are usually I/O-bound.

## Contributing

Monorepo setup, gate, and release: [`CONTRIBUTING.md`](https://github.com/trvswgnr/prodkit/blob/main/CONTRIBUTING.md).
Contributor requirement: Node `>=24.14.0` (24.x Active LTS).
