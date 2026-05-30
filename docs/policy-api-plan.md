# Policy API Plan

## Direction

Move policy composition from dedicated fluent methods to a single `.with(...)` policy attachment
surface.

```ts
import { Delay } from "@prodkit/std";
import * as Policy from "@prodkit/std/policy";

const program = acquireConnection
  .with(Policy.timeout(1_000))
  .with(
    Policy.retry({
      attempts: 3,
      delay: Delay.exponential({ baseMs: 100, maxMs: 1_000, jitter: 0.5 }),
    }),
  )
  .with(Policy.signal(signal))
  .with(Policy.release((conn) => conn.close()));
```

The old dedicated methods become the new policy constructors:

```ts
op.withRetry(policy);
op.withTimeout(ms);
op.withSignal(signal);
op.withRelease(release);
```

becomes:

```ts
op.with(Policy.retry(policy));
op.with(Policy.timeout(ms));
op.with(Policy.signal(signal));
op.with(Policy.release(release));
```

Keep lifecycle hooks as lifecycle hooks:

```ts
op.on("enter", initialize);
op.on("exit", finalize);
```

Do not move `on(...)`, `map(...)`, `mapErr(...)`, `flatMap(...)`, `tap(...)`, `tapErr(...)`, or
`recover(...)` under `Policy`.

## Package Boundary

`@prodkit/op` owns the policy mechanism:

- `.with(...)`
- policy ordering semantics
- plan application
- timeout, signal, retry, and release runtime behavior
- `TimeoutError`
- internal validation and normalization needed to run policies

`@prodkit/std` owns the public policy constructor surface:

- `@prodkit/std/policy`
- `Policy.retry(...)`
- `Policy.timeout(...)`
- `Policy.signal(...)`
- `Policy.release(...)`

`@prodkit/std` also owns public retry delay helpers:

```ts
import { Delay } from "@prodkit/std";
```

`Delay` is not a policy. It is a standard helper namespace used by retry policies.

The dependency direction stays one way:

```txt
@prodkit/std -> @prodkit/op
```

`@prodkit/op` must not import from `@prodkit/std`.

## Public Imports

Canonical policy import:

```ts
import * as Policy from "@prodkit/std/policy";
```

Canonical delay import:

```ts
import { Delay } from "@prodkit/std";
```

Retry usage:

```ts
op.with(
  Policy.retry({
    attempts: 5,
    when: (cause) => cause instanceof FetchError,
    delay: Delay.exponential({ baseMs: 200, maxMs: 2_000, jitter: 0.5 }),
  }),
);
```

Default retry usage:

```ts
op.with(Policy.retry());
```

## Retry Contract

Preserve the existing retry contract.

```ts
export type RetryDelay = number | ((attempt: number, cause: unknown) => number);

export interface RetryPolicy {
  attempts?: number;
  when?: (cause: unknown) => boolean;
  delay?: RetryDelay;
}

export interface ExponentialDelayOptions {
  baseMs?: number;
  maxMs?: number;
  jitter?: number;
}
```

Defaults remain:

- `attempts: 3`
- `when: () => true`
- exponential delay from `1000ms` to `30000ms`
- full jitter, `jitter: 1`

Delay helpers remain conceptually the same:

```ts
Delay.fixed(ms);
Delay.exponential({ baseMs, maxMs, jitter });
Delay.immediate;
Delay.defaultRetry;
```

Invalid retry and delay inputs should keep surfacing at run time as `Err(UnhandledException)` with
the validation error as `cause`.

## Type Strategy

Do not require a higher-kinded type migration for the first policy cutover.

The first implementation can use a closed built-in policy model because the agreed policies have
known transforms:

```txt
retry   : Op<T, E, A, M> -> Op<T, E, A, M>
timeout : Op<T, E, A, M> -> Op<T, E | TimeoutError, A, M>
signal  : Op<T, E, A, M> -> Op<T, E, A, M>
release : Op<T, E, A, M> -> Op<T, E, A, M>
```

Higher-kinded types become relevant only if `@prodkit/op` later exposes an open, user-extensible
policy protocol where third-party policies can describe arbitrary type transforms.

Before committing `withRelease(...)` to `Policy.release(...)`, spike contextual typing:

```ts
acquireConnection.with(Policy.release((conn) => conn.close()));
```

This must preserve the current ergonomics where `conn` is inferred from the success value of the
source op. If TypeScript cannot preserve that inference, keep `.withRelease(...)` as a dedicated
method and move only retry, timeout, and signal to `Policy`.

## Implementation Slices

### 1. Add `.with(...)` and the built-in policy carrier in `@prodkit/op`

Build the internal policy carrier and fluent `.with(policy)` method.

Acceptance criteria:

- `.with(Policy.retry(...))` has equivalent runtime behavior to `.withRetry(...)`.
- `.with(Policy.timeout(ms))` has equivalent runtime behavior to `.withTimeout(ms)`.
- `.with(Policy.signal(signal))` has equivalent runtime behavior to `.withSignal(signal)`.
- `.with(Policy.release(release))` has equivalent runtime behavior to `.withRelease(release)`, if
  contextual typing remains ergonomic.
- Type tests prove retry, signal, and release preserve the op type.
- Type tests prove timeout widens the error channel with `TimeoutError`.
- Policy order remains left-to-right and preserves the existing retry/timeout ordering semantics.

### 2. Add `@prodkit/std/policy` and move public policy constructors

Add the canonical standard-library policy module.

Acceptance criteria:

- `import * as Policy from "@prodkit/std/policy"` exposes `retry`, `timeout`, `signal`, and
  `release`.
- `import { Delay } from "@prodkit/std"` exposes retry delay helpers.
- `RetryPolicy`, `RetryDelay`, and `ExponentialDelayOptions` are public from an appropriate std
  surface.
- `@prodkit/std` depends on `@prodkit/op`; `@prodkit/op` does not depend on `@prodkit/std`.
- Runtime and type tests cover policy constructors from the std import paths.

### 3. Hard-cutover docs, examples, tests, and public API

Remove the dedicated public policy methods once the new policy API is in place.

Acceptance criteria:

- Replace `.withRetry(...)` with `.with(Policy.retry(...))`.
- Replace `.withTimeout(...)` with `.with(Policy.timeout(...))`.
- Replace `.withSignal(...)` with `.with(Policy.signal(...))`.
- Replace `.withRelease(...)` with `.with(Policy.release(...))` if release passed the contextual
  typing spike.
- Keep `.on("enter", ...)` and `.on("exit", ...)` unchanged.
- Update README, DESIGN/ADR references, examples, comparison docs, and tests.
- Update `packages/op/CHANGELOG.md` and `packages/std/CHANGELOG.md` under `Unreleased`.
- Remove root `@prodkit/op` exports for public retry policy helpers that moved to std, unless a
  compatibility subpath is intentionally retained.
- `pnpm run gate` passes.

## GitHub Issue Drafts

### Issue 1: Add typed `.with(...)` policy composition to `@prodkit/op`

Build a single policy attachment method for built-in policy carriers while preserving existing
runtime semantics and type behavior.

Acceptance criteria:

- `.with(...)` supports retry, timeout, signal, and release carriers.
- Retry, signal, and release preserve success, error, args, and metadata types.
- Timeout widens the error channel with `TimeoutError`.
- Existing policy ordering behavior is preserved.
- `Policy.release(...)` contextual typing is spiked and documented in the implementation result.

Blocked by: None.

### Issue 2: Add `@prodkit/std/policy` and move policy constructors to std

Expose the public policy constructor API from the standard library while keeping `op` as the owner
of execution mechanics.

Acceptance criteria:

- `@prodkit/std/policy` exports `retry`, `timeout`, `signal`, and conditionally `release`.
- `@prodkit/std` exports `Delay`.
- Retry policy and delay helper types are available from std.
- `std -> op` remains the only package dependency direction.
- Tests cover std policy constructors through public import paths.

Blocked by: Issue 1.

### Issue 3: Hard-cutover from dedicated fluent policy methods to `.with(Policy.*)`

Update the public API, examples, docs, and tests to use the new policy surface.

Acceptance criteria:

- Public docs use `import * as Policy from "@prodkit/std/policy"`.
- Public docs use `import { Delay } from "@prodkit/std"`.
- Dedicated policy methods are removed from the public `Op` surface.
- Lifecycle hooks remain `.on("enter", ...)` and `.on("exit", ...)`.
- Changelogs describe the breaking change.
- `pnpm run gate` passes.

Blocked by: Issues 1 and 2.
