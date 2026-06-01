# @prodkit/op

A runtime-agnostic, composable, and predictable library for writing operations in TypeScript, built on top of [`better-result`](https://github.com/dmmulroy/better-result).

This README documents the `@prodkit/op` package API and usage.
For monorepo/workspace orientation, see the repo root [`README.md`](https://github.com/trvswgnr/prodkit/blob/main/README.md).
For tradeoffs against Effect, neverthrow, `fp-ts`, native `Promise`, and `ResultAsync`, see
[`COMPARISON.md`](https://github.com/trvswgnr/prodkit/blob/main/packages/op/COMPARISON.md).
For runtime overhead ratios, throughput figures, and bundle size, see
[`PERFORMANCE.md`](https://github.com/trvswgnr/prodkit/blob/main/packages/op/PERFORMANCE.md).

> [!WARNING]
> This library is currently in alpha. The API will almost certainly change between releases while it stabilizes.

> [!NOTE]
> Subpath exports (`@prodkit/op/di`, `@prodkit/op/policy`, `@prodkit/op/hkt`, `@prodkit/op/internal`)
> ship with the matching
> npm release. If your installed version predates a subpath, upgrade `@prodkit/op` or import only
> what that version's `package.json` `exports` lists. This repo's `main` branch may document APIs
> still under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) until they are published.

Write code that stays readable as it grows and keep predictable
behavior in production. Compose steps top-to-bottom, apply retry, timeout, and cancellation as
policy, and run parallel work without scattering reliability logic across your app.

## Contents

- [Why this exists](#why-this-exists)
- [Installation](#installation)
- [Dependencies (`better-result`)](#dependencies-better-result)
- [Subpath exports](#subpath-exports)
  - [`@prodkit/op/di`](#prodkitopdi)
  - [`@prodkit/op/policy`](#prodkitoppolicy)
  - [`@prodkit/op/hkt`](#prodkitophkt)
  - [`@prodkit/op/internal`](#prodkitopinternal)
- [Quick start](#quick-start)
- [Core API](#core-api)
  - [`Op(fn)`](#opfn)
  - [`Op.of(value)`](#opofvalue)
  - [`Op.fail(error)`](#opfailerror)
  - [`Op.defer(finalize)`](#opdeferfinalize)
  - [`Op.sleep(ms)`](#opsleepms)
  - [Sleep vs timeout input validation](#sleep-vs-timeout-input-validation)
  - [`Op.try(f, onError?)`](#optryf-onerror)
  - [`Op.run(op, ...args)`](#oprunop-args)
  - [`Op.empty`](#opempty)
  - [`.run(...args)`](#runargs)
  - [`.map(f)`](#mapf)
  - [`.flatMap(f)`](#flatmapf)
  - [`.tap(f)`](#tapf)
  - [`.tapErr(f)`](#taperrf)
  - [`.mapErr(f)`](#maperrf)
  - [`.recover(predicate, handler)`](#recoverpredicate-handler)
  - [`.with(policy)`](#withpolicy)
  - [Cooperative cancellation contract](#cooperative-cancellation-contract)
  - [`.with(Policy.release(release))`](#withpolicyrelease)
  - [`.on("exit", finalize)`](#onexit-finalize)
  - [`.on("enter", initialize)`](#onenter-initialize)
- [Typed errors](#typed-errors)
- [Retry defaults](#retry-defaults)
- [Built-in errors](#built-in-errors)
- [Concurrent combinators](#concurrent-combinators)
- [Webhook consumer example](#webhook-consumer-example)
- [More examples](#more-examples)
- [Performance](#performance)
- [Contributing](#contributing)
- [Publishing](#publishing)

## Why this exists

Async TypeScript has two huge flaws: you can't see from a function's type what it might fail with, and the standard concurrency helpers happily let sibling tasks keep running after one of them blows up. `@prodkit/op` fixes both. It builds on `better-result`'s `Result` model, generator composition, and typed error inference, then adds an async runtime with suspend/resume semantics, structured resource cleanup, cancellation-aware concurrency, and composable retry/timeout policies on top. Concurrency combinators thread cancellation through every child, so when one fails the rest actually stop instead of burning quota in the background. Retry, timeout, and external cancellation attach through `.with(Policy.*)` before `.run()`. Minimal runtime dependencies, a small footprint, and an API that's easy to learn and use.

## Installation

```bash
npm i @prodkit/op
```

Runtime support for consumers: any JavaScript runtime with `Promise` and `AbortController`.
For Node consumers specifically, this package is tested on Node `24.14.0` (24.x Active LTS, the
current LTS line). No Node-specific APIs are required by the public operation model.

CI publishes Vitest coverage for this package and runs unit, integration, type-level, and
property-based law checks, plus packed-package smoke on Bun `1.3.13`, Deno `2.7.14`, and a
Cloudflare Workers-like Miniflare environment.

## Dependencies (`better-result`)

`@prodkit/op` is built on [`better-result`](https://github.com/dmmulroy/better-result) for typed
outcomes, tagged domain errors, and the runtime `UnhandledException` channel. The package declares
`better-result` as a peer dependency so your app installs one copy and TypeScript resolves the
same `Result` types that `.run()` returns.

### Peer dependency range

```json
"better-result": "^2.9.0"
```

Install it alongside `@prodkit/op`. If your package manager does not install peers automatically,
run `npm i better-result` explicitly.

**Compatibility:** releases in the current alpha series target `better-result` 2.x versions that
satisfy `^2.9.0`. Patch and minor updates within that range should stay compatible with the symbols
prodkit uses in public types and runtime behavior. A future `better-result` major would require a
matching `@prodkit/op` release that updates the peer range before you upgrade.

### Public API surface

Most `better-result` symbols are part of prodkit's public contract but are **not** re-exported from
the `@prodkit/op` package entry. Import them from `better-result` in application code; import
operation APIs from `@prodkit/op`.

From **`better-result`** (recommended import path):

- `Result` is the return type of `.run()` and `Op.run()`; also appears on `ExitContext.result`,
  `Op.settle`, and `Op.allSettled`
- `TaggedError` is a factory for typed domain errors (`yield* new MyError()`)
- `UnhandledException` is the normalized failure channel; always included on `.run()` error unions
- `TaggedErrorInstance` provides instance typing for tagged errors
- `Err`, `Ok`, `InferErr` are optional advanced result typing helpers (not re-exported from
  `@prodkit/op`)

From **`@prodkit/op`**:

- `TimeoutError` is the built-in timeout failure from `.with(Policy.timeout(...))`; uses the same
  `TaggedError` pattern as domain errors from `better-result`
- `ErrorGroup` is an aggregate error from `Op.any` when every branch fails (prodkit-specific, not
  from `better-result`)

No other `better-result` exports are published from `@prodkit/op` today.

## Subpath exports

Op-native extensions ship as separate subpath exports on `@prodkit/op`. Import them explicitly; the
main `@prodkit/op` entry does not re-export them ([ADR 0008](https://github.com/trvswgnr/prodkit/blob/main/docs/adr/0008-op-subpath-exports.md) in the monorepo; not shipped in the npm tarball).

### `@prodkit/op/di`

Dependency injection for composed ops: tokens, `inject`, `provide`, and scoped/singleton bindings.

```ts
import { Op } from "@prodkit/op";
import { DI } from "@prodkit/op/di";

interface Database {
  findById(id: number): Promise<{ id: number } | null>;
}

class DatabaseDependency extends DI.Dependency("Database")<Database> {}

const db: Database = {
  findById: async (id) => ({ id }),
};

const getUser = Op(function* (id: number) {
  const database = yield* DI.inject(DatabaseDependency);
  return yield* database.findById(id);
});

const runnable = DI.provide(getUser, DI.singleton(DatabaseDependency, db));
const result = await runnable.run(1);
```

Public exports: `DI` (including `DI.MissingDependencyError` and `DI.DuplicateDependencyError`), top-level
`Dependency`, `inject`, `provide`, `scoped`, `singleton`, and `RequiredDeps`.

**Compile time:** An op that uses `DI.inject` cannot be `.run()` until you satisfy bindings with
`DI.provide(...)` (or partial `provide` while requirements remain). TypeScript surfaces missing
dependencies through `RequiredDeps` and by omitting `.run()` on the op type until they are provided.

**Token identity:** Each dependency slot is the token **class** you declare and pass to
`DI.inject` / `DI.singleton` / `DI.scoped`. The string passed to `DI.Dependency("...")` is a
diagnostic label for errors only; two classes may share the same label and remain separate slots
([ADR 0010](https://github.com/trvswgnr/prodkit/blob/main/docs/adr/0010-di-token-class-identity.md) in the monorepo; not shipped in the npm tarball).

**Run time:** If you call `.run()` without a required binding, or provide the same token class
twice, the run fails with `Err(UnhandledException)` from `better-result`. The DI-specific fault is
on `error.cause`, not on the op's typed error channel `E`:

```ts
import { UnhandledException } from "better-result";
import { Op } from "@prodkit/op";
import { DI } from "@prodkit/op/di";

class DatabaseDependency extends DI.Dependency("Database")<unknown> {}

const op = Op(function* () {
  yield* DI.inject(DatabaseDependency);
  return "unreachable";
});

const result = await op.run();
if (result.isErr() && UnhandledException.is(result.error)) {
  const { cause } = result.error;
  if (DI.MissingDependencyError.is(cause)) {
    console.error(`missing binding: ${cause.key}`);
  } else if (DI.DuplicateDependencyError.is(cause)) {
    console.error(`duplicate binding: ${cause.key}`);
  }
}
```

Runnable consumer examples live under
[`examples/op/di/`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/di/) (onboarding,
scoped cancellation, HTTP handler with pool checkout).

### `@prodkit/op/policy`

Policy constructors and retry delay helpers. The main `@prodkit/op` entry owns execution mechanics;
the policy subpath only builds values passed to `.with(...)`.

```ts
import { Op } from "@prodkit/op";
import { Delay, Policy } from "@prodkit/op/policy";

const policy = {
  retries: 2,
  when: (cause: unknown) => cause instanceof Error,
  delay: Delay.exponential({ baseMs: 100, maxMs: 1_000, jitter: 0.5 }),
};

const result = await Op.try(() => fetch("https://example.com"))
  .with(Policy.retry(policy))
  .with(Policy.timeout(1_000))
  .run();
```

Public exports:

- Values: `Policy`, `Delay`
- Types: `Policy` (custom policy values and factories), `Policy.Input`, `Policy.Source`, `Policy.Type`,
  `Policy.BuiltIn`, `RetryPolicy`, `Delay` (retry delay configuration), `ExponentialDelayOptions`,
  `RetryPolicyAttachment`, `TimeoutPolicyAttachment`, `CancelPolicyAttachment`,
  `ReleasePolicyAttachment`, `TimeoutPolicyType`

Built-in attachments use `Policy.retry`, `Policy.timeout`, `Policy.cancel`, and `Policy.release`.
Custom policies use `Policy.define(...)`. Custom policies that transform `Op<T, E, A, M>` at the
type level use the HKT protocol; import `HKT` from `@prodkit/op/hkt` (see below), not from this
subpath.

Policy ordering semantics are summarized under [`.with(policy)`](#withpolicy) and
[Retry defaults](#retry-defaults) below, and in [`DESIGN.md`](DESIGN.md#policy-ordering-retry-and-timeout).

### `@prodkit/op/hkt`

Reusable higher-kinded type encoding for modules that need an open type-level transform.
Policy uses it to let custom `.with(...)` attachments describe how they transform `Op<T, E, A, M>`
without adding overloads to core.

```ts
import { HKT } from "@prodkit/op/hkt";

type Maybe<A> =
  | { readonly _tag: "Some"; readonly value: A }
  | { readonly _tag: "None" };

interface MaybeF extends HKT {
  readonly [HKT.TYPE]: Maybe<HKT.Param<this, 0>>;
}

type Name = HKT.Apply<MaybeF, readonly [string]>;
//   ^? Maybe<string>

type Either<E, A> =
  | { readonly _tag: "Left"; readonly error: E }
  | { readonly _tag: "Right"; readonly value: A };

interface EitherF extends HKT {
  readonly [HKT.TYPE]: Either<HKT.Param<this, 0>, HKT.Param<this, 1>>;
}

// Fix1<EitherF, E> is the usual "Either with E fixed" view before you supply A.
type HttpResult<A> = HKT.Apply<HKT.Fix1<EitherF, { status: number }>, readonly [A]>;
//   ^? Either<{ status: number }, A>
```

Policy uses the same encoding: `[HKT.TYPE]` is `Op<...>`, args are `[T, E, A, M]`, and
`Policy.timeout(...)` widens `E` with `TimeoutError` without a core `.with` overload.

Public export: `HKT` (interface, namespace, and frozen `{ PARAMS, TYPE }` symbol constants).
Namespace members: `HKT.Param`, `HKT.Apply`, `HKT.Compose`, `HKT.Flip`, `HKT.Fix1`, `HKT.Fix2`, and
`HKT.Fix12`.
Import from here for custom `Policy.define(...)` attachments and other op extensions; the policy
subpath does not re-export these symbols.

#### Custom policy checklist

1. Import `Policy` from `@prodkit/op/policy` and `HKT` from `@prodkit/op/hkt` (policy does not
   re-export HKT).
2. Declare a policy HKT with `[HKT.TYPE]: Op<...>` describing how the attachment transforms
   `Op<T, E, A, M>` (for example widening `E` with a domain error).
3. Return `Policy.define(...)` from a factory typed as `Policy<unknown, YourPolicyHKT>`; use
   `source.wrap`, `source.rewrite`, or `source.around` inside `apply`.
4. Attach with `.with(yourPolicy(...))` before `.run()`.

Runnable walkthrough:
[`examples/op/custom-policy.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/custom-policy.ts).
Type-level coverage lives in
[`policy-hkt.test.ts`](https://github.com/trvswgnr/prodkit/blob/main/packages/op/tests/unit/policy-hkt.test.ts).

### `@prodkit/op/internal`

Low-level exports for op extension authors (metadata, `Blocking`, `withBlocking`,
`CustomInstruction`, `AbortSignalLike`, and related helpers). Not part of the default application
import surface; see `CONTRIBUTING.md` for usage.

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
  // any value can be passed to Op.fail, but it should be discriminative
  if (n < 0) return yield* Op.fail("Negative");
  return Math.sqrt(n);
});

const program = Op(function* () {
  const quotient = yield* divide(10, 2);
  const rooted = yield* sqrt(quotient);
  return rooted * 2;
});

// Nullary generator-built ops can compose directly. Parameterized ops are invoked first.
const startup = Op(function* () {
  return "ready";
});
const composed = Op(function* () {
  return yield* startup;
});

const result = await program.run();
//    ^? Result<number, DivisionByZeroError | "Negative" | UnhandledException>
if (result.isOk()) {
  console.log(result.value);
} else {
  console.error(result.error);
}
```

## Core API

### `Op(fn)`

Turns a generator into a composable operation.
Inside the generator, `yield*` another op to unwrap success or short-circuit on failure.
Parameterized ops must be invoked before composition: use `yield* loadUser(id)`, not
`yield* loadUser`.

### `Op.of(value)`

Creates an op that succeeds with `value`.
If `value` is a promise, it is awaited and converted into the same `Result` model.

### `Op.fail(error)`

Creates an op that always fails with `error`.

### `Op.defer(finalize)`

Registers cleanup for the **current** op run inside a generator. **`finalize(ctx)`** receives **`ExitContext`**:
the run `AbortSignal`, runtime **`args`**, plus **`result`**: the operation's pre-finalizer settlement result (from `better-result`, so use `.isOk()` / `.isErr()` as usual).

Deferred callbacks share one stack
with `.with(Policy.release(...))` / `.on("exit", ...)`: they run in **LIFO** order when the run unwinds (success, typed
failure, `UnhandledException`, timeout, or external cancellation). **All** scheduled finalizers run;
even if one throws, the **remaining** callbacks in the stack **still run**. If a single finalizer throws, `.run()` returns
`Err(UnhandledException)` with `cause` set to that fault. If **multiple** finalizers throw, `cause`
is a nested **`Error` chain**: the outer error matches the **first** failure during teardown
(last-registered callback runs first, so it fails first; read the chain outer-to-inner that way); each
`.cause` is the next fault in unwind order. Only **throwing** callbacks appear in the chain: cleanups that finish
without throwing add no links. `finalize` can
be sync or async.

Use `Op.defer`/`.with(Policy.release(...))`/`.on("exit", ...)` for effectful cleanup. Native generator
`finally` blocks are only best-effort synchronous finalization; yielded or async work inside
`finally` is not driven during early exit. Register defer **before** risky steps, not inside `finally`:

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

`Policy.release` invokes only `release(successValue)` (no context parameter); its stack slot is invoked with the
same **`ExitContext`** as other finalizers for this run, but the release function ignores it.

Use this for step-local teardown that reads better than attaching release policy to every producer,
or for "always run" cleanup before a risky step.

```ts
const runQuery = Op(function* () {
  const conn = yield* acquireConnection;
  yield* Op.defer(() => conn.release());

  return yield* getActiveUsers(conn);
});
```

```ts
const risky = Op(function* () {
  yield* Op.defer(() => invalidateTempFiles());
  return yield* commitTransaction();
});
```

`Op.defer` is only meaningful inside an `Op(function* () { ... })` body (compose with `yield*`).
For releasing the **success value** of a single op, `.with(Policy.release(...))` on that op is often clearer.
For lifecycle hooks at op boundaries, `.on("enter", fn)` runs setup when a wrapper starts and
`.on("exit", fn)` runs teardown when the run unwinds.

### `Op.sleep(ms)`

Creates an op that waits for `ms` milliseconds and then succeeds with `void`.
Negative durations are normalized to `0`. Non-finite durations fail at run time with
`UnhandledException`.

`Op.sleep` observes surrounding cancellation policy. If a run is cancelled by
`.with(Policy.cancel(...))`, `.with(Policy.timeout(...))`, or a combinator abort while sleeping,
the sleep stops early and the run surfaces the cancellation through the normal
`UnhandledException` channel.

```ts
const poll = Op(function* () {
  while (true) {
    const job = yield* loadJob;
    if (job.ready) return job;
    yield* Op.sleep(250);
  }
});
```

### Sleep vs timeout input validation

Both validate at run time (when the wrapped operation first runs), not at attach time. Invalid
values settle to `Err(UnhandledException)` with the validation error as `cause`; they do not throw
out of `.run()`.

| Input | Negative | Non-finite |
| --- | --- | --- |
| `Op.sleep(ms)` | Normalized to `0` | `Err(UnhandledException)` |
| `Policy.timeout(timeoutMs)` | `Err(UnhandledException)` (not clamped) | `Err(UnhandledException)` |

See [`DESIGN.md`](DESIGN.md#invariant-input-normalization-and-validation-at-run-time) for the full
invariant table, including retry policy validation.

### `Op.try(f, onError?)`

Runs an async or sync function and converts failures into `Err`.
If `onError` is omitted, failures become `UnhandledException`.
`onError` returns the error value `Op.try` should emit (or a `Promise` of that value). If it
returns an `Op`/generator object, `Op.try` treats that object as the error value and does not run
it.

`f` receives an `AbortSignal` tied to surrounding cancellation policy (`Policy.timeout`,
`Policy.cancel`, and combinator cancellation). Forward it to cancellable APIs so in-flight work
(e.g. `fetch`, DB queries) actually stops instead of leaking after a timeout.

```ts
import { Policy } from "@prodkit/op/policy";

const fetchUser = Op.try((signal) => fetch("/api/users/1", { signal }));
const result = await fetchUser.with(Policy.timeout(1000)).run();
// when the 1s budget elapses, the fetch is aborted.
```

```ts
const mapped = await Op.try(
  () => Promise.reject("boom"),
  (cause) => `mapped: ${String(cause)}`,
).run();
// Result<never, "mapped: boom" | UnhandledException>
```

### `Op.run(op, ...args)`

Static runner for ops. This is equivalent to `op.run(...args)`, and is useful when you want to
execute an op value passed around as data.
`Op.run(op, ...args)` does not expose a cancel handle; if the caller needs external cancellation, compose
the op with `.with(Policy.cancel(signal))` before running it.

```ts
const result = await Op.run(Op.of(7));

const add = Op(function* (a: number, b: number) {
  return a + b;
});
const sum = await Op.run(add, 2, 5);
```

### `Op.empty`

Reusable no-op that succeeds with `void`.

```ts
const result = await Op.empty.run();
```

### `.run(...args)`

Executes the operation and returns `Result<T, E | UnhandledException>` from `better-result`.

```ts
const result = await op.run(...args);
if (result.isOk()) {
  console.log(result.value);
} else {
  console.error(result.error);
}
```

### `.map(f)`

Transforms an op's success value while preserving the same error channel and argument list.
Use this when you want a one-step value transformation without writing a generator.

```ts
const userId = Op.of({ id: 69, name: "Marissa" }).map((user) => user.id);
const result = await userId.run(); // Result<number, UnhandledException>
```

### `.flatMap(f)`

Chains to the next op using the previous success value. This is the monadic bind operation:
the next op only runs after the first one succeeds, and both error channels are preserved.

```ts
const getUserTodos = getUser(69).flatMap((user) => getTodos(user.id));
const result = await getUserTodos.run();
```

### `.tap(f)`

Observes a successful value without changing it. This is useful for logging, metrics, tracing,
or debugging in the middle of a pipeline without restructuring into a generator.

Return values from `f` are always ignored; returned ops are not run. If observation needs to run
another operation, use a generator and `yield*` that operation explicitly. If `f` throws, the
failure surfaces as `UnhandledException`.

```ts
const withLog = Op.try(() => fetch("https://example.com/user/69"))
  .tap((response) => {
    console.log("status", response.status);
  })
  .map((response) => response.status);
```

### `.tapErr(f)`

Observes typed failures without changing which error is returned. This is useful for error metrics,
structured logging, and alert hooks while preserving existing control flow.

Return values from `f` are always ignored; returned ops are not run. If error observation needs to
run another operation, use a generator and `yield*` that operation explicitly. If `f` throws, the
failure surfaces as `UnhandledException`. `UnhandledException` bypasses `tapErr`.

```ts
const withErrorMetric = Op.try(
  () => fetch("https://example.com/user/69"),
  (cause) => new FetchError({ cause }),
).tapErr((error) => {
  console.error("user lookup failed", error.message);
});
```

### `.mapErr(f)`

Transforms an op's typed error channel while preserving the success value and argument list.
Use this when you want to normalize or enrich domain failures without restructuring into a
generator.

`UnhandledException` is part of the runtime channel and bypasses `mapErr`; only tracked typed
errors are passed to `f`.

```ts
const normalizeFetchError = Op.try(
  () => fetch("https://example.com/user/69"),
  (cause) => new FetchError({ cause }),
).mapErr((e) => (FetchError.is(e) ? new UserLookupError({ cause: e }) : e));
```

### `.recover(predicate, handler)`

Recovers from selected typed failures while preserving the rest of the error channel. Pass a type
predicate such as `MyError.is` or `(error): error is MyError => MyError.is(error)`. `handler`
returns a fallback value; returned ops are treated as fallback data, not run. Use `flatMap` or a
generator with `yield*` when recovery needs to run another operation.

`UnhandledException` is intentionally not recoverable through this method; unexpected throws
still surface so bugs are not silently converted into success paths.

```ts
class NotFoundError extends TaggedError("NotFoundError")() {}
class PermissionError extends TaggedError("PermissionError")() {}

const lookup = Op(function* (id: string) {
  if (id === "missing") return yield* new NotFoundError();
  if (id === "forbidden") return yield* new PermissionError();
  return { id };
}).recover(NotFoundError.is, () => ({ id: "fallback" }));

// lookup: Op<{ id: string }, PermissionError, [string]>
```

### `.with(policy)`

Attaches retry, timeout, external cancellation, or success-value release policy to an operation. Built-in policy values
come from `@prodkit/op/policy`.

```ts
import { Policy } from "@prodkit/op/policy";

const policy = {
  retries: 2,
  when: (cause: unknown) => cause instanceof Error,
  delay: (retry: number) => (retry + 1) * 100,
};

const fetchWithRetry = Op.try(() => fetch("https://example.com")).with(Policy.retry(policy));
```

`Policy.retry(policy?)` wraps an operation with retries. `retries` counts post-failure retries only
(`retries: 0` runs once). Custom `delay(retry, cause)` callbacks receive a 0-based retry index
(`0` after the first failure). See [Retry defaults](#retry-defaults). `Policy.timeout(timeoutMs)` wraps an
operation with a timeout and fails with `TimeoutError` when the wrapped operation does not finish
before `timeoutMs`. Invalid retry policy shapes and invalid timeout values (negative or non-finite
`timeoutMs`) fail at run time as `Err(UnhandledException)` with the validation error as `cause`, not
as thrown exceptions from `.run()`. `Policy.cancel(signal)` binds an operation to an external `AbortSignal` so you
can cancel in-flight work, for example when an HTTP request is aborted or a job is shut down.
`Policy.release(release)` registers success-gated release logic for the wrapped operation's
successful value. Library authors can also pass custom policies built with `Policy.define(...)`
when they need a reusable wrapper that preserves the operation API while adding behavior such as
short-circuiting, metering, or domain-specific failure handling.

Composition order determines semantics:

```ts
// timeout applies to the ENTIRE retried run
const totalBudget = Op.try(() => fetch("https://example.com"))
  .with(Policy.retry(policy))
  .with(Policy.timeout(5000));

// timeout applies to each run inside the retry loop
const perAttempt = Op.try(() => fetch("https://example.com"))
  .with(Policy.timeout(5000))
  .with(Policy.retry(policy));
```

```ts
const controller = new AbortController();
const fetchUser = Op.try((signal) => fetch("/api/users/1", { signal })).with(
  Policy.cancel(controller.signal),
);

const runPromise = fetchUser.run();
controller.abort(new Error("request cancelled"));
const result = await runPromise;
```

### Cooperative cancellation contract

Cancellation is cooperative, not preemptive. `@prodkit/op` guarantees that it raises abort
signals at the right points, but your operation code must observe those signals for work to
stop quickly.

Runtime guarantees:

- `.with(Policy.timeout(...))`, `.with(Policy.cancel(...))`, and short-circuiting combinators
  (`Op.all`, `Op.any`, `Op.race`) propagate abort through `AbortSignal`.
- `Op.sleep(ms)` observes abort signals and stops waiting early when its enclosing run is cancelled.
- When a combinator decides its final result early, in-flight siblings are aborted and the
  combinator waits for them to settle before returning.
- Scheduled teardown still runs (`Op.defer`, `.with(Policy.release(...))`, `.on("exit", ...)`) even when a run
  ends via timeout or external abort.

Caller responsibilities:

- Build side-effecting work with `Op.try((signal) => ...)` and pass `signal` to cancellable APIs
  (`fetch`, DB clients, queue clients, etc.).
- Keep composed child ops signal-aware so branch-level cancellation in combinators can stop
  downstream IO.
- Treat cancellation as a stop request: if an underlying dependency ignores `AbortSignal`, that
  dependency can continue running after the op settles.

Recommended composed-run wiring:

```ts
import { Policy } from "@prodkit/op/policy";

const controller = new AbortController();

const fetchJson = (url: string) =>
  Op.try(async (signal) => {
    const res = await fetch(url, { signal });
    return res.json();
  });

const loadDashboard = Op.all([
  fetchJson("/api/users/1"),
  fetchJson("/api/alerts"),
  fetchJson("/api/settings"),
])
  .with(Policy.timeout(1_500))
  .with(Policy.cancel(controller.signal));

const runPromise = loadDashboard.run();

// for example: HTTP disconnect, worker shutdown, or route transition
controller.abort(new Error("caller aborted dashboard load"));

const result = await runPromise;
```

### `.with(Policy.release(release))`

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
**succeeds**, so a failing inner op does not call `release`. If `release` throws, the run fails
with `UnhandledException` and `cause` set to that fault (other registered finalizers **still run**
afterward in LIFO order; multiple faults become a **nested `Error.cause` chain**, same as `Op.defer`).

### `.on("exit", finalize)`

Registers unconditional finalization when the enclosing run settles (success or failure), on the same LIFO stack as `Op.defer` and `.with(Policy.release(...))`. **`finalize(ctx)`** receives **`ExitContext`** with run `args` and the pre-finalizer **`ctx.result`**. If `finalize` throws, `.run()` fails with `UnhandledException` and `cause` set to that fault (or a nested **`error.cause` chain** if several finalizers fault).

```ts
const result = await doWork.on("exit", (ctx) => telemetry.record(ctx)).run();
```

### `.on("enter", initialize)`

Registers run-start initialization before the wrapped op body is driven. `initialize(ctx)`
receives `EnterContext` with the run `signal` and runtime `args`.

```ts
const result = await doWork
  .on("enter", ({ signal, args }) =>
    telemetry.startSpan({ aborted: signal.aborted, key: String(args[0]) }),
  )
  .on("exit", (ctx) => telemetry.finishSpan({ args: ctx.args, result: ctx.result }))
  .run();
```

Ordering/composition rules:

- Enter handlers run in wrapper order (last chained runs first).
- Exit handlers keep the current unwind ordering.
- Enter handlers run once per wrapper run; retry runs happen inside that wrapper regardless
  of whether `.with(Policy.retry(...))` is chained before or after `.on("enter", fn)`.

## Typed errors

Use `TaggedError("Name")` for discriminated domain errors that still behave like real `Error` objects.
You can fail with one directly with `yield* new MyError()` inside an op.

```ts
import { Op } from "@prodkit/op";
import { TaggedError } from "better-result";

class ValidationError extends TaggedError("ValidationError")<{
  field: string;
}>() {}

const validate = Op(function* (name: string) {
  if (name.trim().length === 0) {
    yield* new ValidationError({ field: "name", message: "Name is required" });
  }
  return name;
});
```

## Retry defaults

`.with(Policy.retry())` with no policy uses:

- `retries: 2`
- `when: () => true`
- exponential backoff from `1000ms` up to `30000ms` with full jitter (`1.0`)

You can also build your own delay function with `Delay.fixed(ms)` or
`Delay.exponential({ baseMs, maxMs, jitter })`.
`Delay.defaultRetry` is the pre-built delay function used by the default retry policy.
Custom delay functions receive `(retry, cause)` where `retry` is the 0-based index of the upcoming
retry (`0` after the first failure, `1` before the second retry, and so on).

```ts
import { Delay } from "@prodkit/op/policy";

const policy = {
  retries: 4,
  when: (cause: unknown) => cause instanceof Error,
  delay: Delay.exponential({ baseMs: 200, maxMs: 2_000, jitter: 0.5 }),
};
```

## Built-in errors

- `UnhandledException`: default wrapper when a thrown/rejected value is not mapped to a domain error.
- `TimeoutError`: produced by `.with(Policy.timeout(timeoutMs))` when the budget expires.
- `ErrorGroup`: produced by `Op.any` when all children fail.
- **Teardown chains:** if several of `Op.defer`, `.with(Policy.release(...))`, or `.on("exit", ...)` callbacks throw in one run, `UnhandledException.cause` may be an `Error` whose `.cause` links onward (**first failure in LIFO execution order is the outermost message**).

## Concurrent combinators

Run multiple ops concurrently and compose them back into one `Op`.
When a result is decided early (`all` after a failure, `any` after a success, `race` on first
settle), remaining work is cancelled through `AbortSignal`. `Op.all`, `Op.any`, and `Op.race`
interrupt aborted losers at suspend boundaries so the combinator still settles when a branch never
observes the signal; `Op.allSettled` relies on cooperative cancel only.

### `Op.all(ops, concurrency?)`

Runs ops concurrently and succeeds with a tuple of their success values. Fails fast on the first
failure; in-flight siblings receive an abort and the combinator waits for them to settle before
returning. Empty input succeeds with `[]`.

Pass a positive integer `concurrency` to cap how many children run at once. Without it, every child
starts immediately. With a cap, `Op.all` stops launching queued children after the first failure.

```ts
const r = await Op.all([Op.of(1), Op.of("two"), Op.of(true)]).run();
if (r.isOk()) {
  const [n, s, b] = r.value; // [number, string, boolean]
}

const bounded = await Op.all(fetchOps, 5).run(); // at most 5 active children
```

### `Op.allSettled(ops, concurrency?)`

Waits for every op and returns a tuple of their `Result`s in input order. For valid inputs it does
not fail and does not short-circuit siblings on child failure.

Pass a positive integer `concurrency` to cap how many children run at once. Unlike `Op.all`,
`Op.allSettled` keeps launching queued children after failures so every input gets a `Result`.
If `concurrency` is not a positive integer, the run fails with `UnhandledException`.

```ts
const r = await Op.allSettled([Op.of(1), Op.fail("nope")]).run();
if (r.isOk()) {
  const [a, b] = r.value; // Result<number, ...>, Result<never, "nope" | ...>
}
```

### `Op.settle(op)`

Runs one op and returns its settled `Result` as a success value. This never fails, which makes it
useful for optional/best-effort reads where fallback logic should continue in the same generator.

```ts
const loadPolicy = Op(function* () {
  const settled = yield* Op.settle(loadPolicyVersion);
  return settled.isOk() ? settled.value : "unknown";
});
```

### `Op.any(ops)`

Succeeds with the first op to succeed; remaining siblings are aborted. If every op fails,
the combinator fails with `ErrorGroup` whose `errors` array holds each child failure
in input index order. Empty input fails with an empty `ErrorGroup` and the message
`"Op.any requires at least one operation"`.

```ts
import { ErrorGroup } from "@prodkit/op";

const r = await Op.any([Op.fail("a"), Op.of(69)]).run();
if (r.isOk()) console.log(r.value); // 69
if (r.isErr() && r.error instanceof ErrorGroup) console.log(r.error.errors);
```

### `Op.race(ops)`

Propagates whichever op settles first: success or failure. Remaining siblings are
aborted with no library-specific reason. `Op.race([])` fails fast with
`UnhandledException`.

```ts
const r = await Op.race([slow, fast]).run();
```

## Webhook consumer example

See the repository example at
[`examples/op/webhook.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/webhook.ts)
for a complete order webhook pipeline
that demonstrates:

- input validation with typed domain errors
- idempotency checks
- risk scoring with provider fallback via `Op.any`
- cache/config policy lookup via `Op.race`
- concurrent inventory/payment orchestration via `Op.all`
- best-effort side effects via `Op.allSettled`
- retry + timeout budgets with `.with(Policy.retry(...))` and `.with(Policy.timeout(...))`
- abort propagation into in-flight calls through `AbortSignal`

Run the consumer-level checks (repo contributors, from monorepo root):

```bash
pnpm --filter @prodkit/tools run examples:smoke:pack
```

Run all cross-runtime smoke checks for Bun, Deno, and a Cloudflare Workers-like runtime
when both `bun` and `deno` are on `PATH`:

```bash
pnpm --filter @prodkit/tools run runtime:smoke
```

You can also run one runtime at a time with `runtime:smoke:bun`, `runtime:smoke:deno`,
or `runtime:smoke:edge`.

## More examples

- [`examples/op/simple.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/simple.ts):
  minimal composition and typed error walkthrough.
- [`examples/op/di/onboarding.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/di/onboarding.ts):
  `@prodkit/op/di` wiring with singleton bindings and typed domain errors.
- [`examples/op/di/di-cancellation.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/di/di-cancellation.ts):
  scoped bindings, run `AbortSignal`, and cancellation during factory resolution.
- [`examples/op/di/http-handler.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/di/http-handler.ts):
  pool checkout with `Op.defer` and layered DI bindings.
- [`examples/op/custom-policy.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/custom-policy.ts):
  custom `Policy.define(...)` attachment with an HKT error transform.
- [`examples/smoke.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/smoke.ts):
  consumer-level scenario assertions for Op flows (`examples/op/smoke.ts`) and DI
  (`examples/op/di/smoke.ts`).

## Performance

`@prodkit/op` adds measurable runtime overhead compared with raw `Promise` usage in
microbenchmarks. Real applications are usually dominated by I/O, so relative overhead matters
less once network or database latency is in the picture.

See [`PERFORMANCE.md`](https://github.com/trvswgnr/prodkit/blob/main/packages/op/PERFORMANCE.md)
for the latest snapshot from the benchmark harness, including all paired scenarios, ops/sec
figures, slowdown ratios, and bundle size.

## Contributing

For monorepo setup, local development, release flow, and publish procedures, see
[`CONTRIBUTING.md`](https://github.com/trvswgnr/prodkit/blob/main/CONTRIBUTING.md).

## Publishing

Contributor requirement: Node `>=24.14.0` (active LTS)
