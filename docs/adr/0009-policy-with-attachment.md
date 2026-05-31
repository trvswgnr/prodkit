---
status: accepted
title: Policy attaches via .with(Policy.*)
packages:
  - "@prodkit/op"
---

# Policy attaches via .with(Policy.*)

ADR 0006 established args-only `.run()` and fluent policy composition on the op value. The public
surface exposed dedicated retry, timeout, cancel, and release methods, while policy constructors
and delay helpers lived on the root `@prodkit/op` export.

## Decision

**Single attachment surface for execution policy.** Retry, timeout, cancel, and release compose through
`.with(policy)` on the op value:

```ts
import { Delay } from "@prodkit/op/policy";
import * as Policy from "@prodkit/op/policy";

acquireConnection
  .with(Policy.timeout(1_000))
  .with(Policy.retry({ retries: 2, delay: Delay.exponential({ baseMs: 100, maxMs: 1_000 }) }))
  .with(Policy.cancel(signal))
  .with(Policy.release((conn) => conn.close()));
```

Dedicated retry, timeout, cancel, and release methods are removed after the new surface is in place
(hard cutover).

**Constructors on `@prodkit/op/policy`.** Policy constructors (`Policy.retry`, `Policy.timeout`,
`Policy.cancel`, `Policy.release`), `Delay`, and related public types ship on the policy subpath
per ADR 0008. The main entry owns `.with(...)`, policy ordering, plan application, runtime behavior,
and `TimeoutError`.

**Lifecycle and transforms stay on `Op`.** Do not move `on(...)`, `map(...)`, `mapErr(...)`,
`flatMap(...)`, `tap(...)`, `tapErr(...)`, or `recover(...)` under `Policy`.

## Release typing spike

Before committing `Policy.release(...)`, verify contextual typing:

```ts
acquireConnection.with(Policy.release((conn) => conn.close()));
```

`conn` must infer from the source op success type.

Result: the spike passed once the release overload was placed first. With the release overload
last, TypeScript infers the callback parameter as `unknown`; with release first, `conn` infers from
the source op success value while timeout still widens the error channel.

## Considered options

**Keep dedicated fluent methods only.** Rejected: two parallel surfaces (methods plus future
`.with(...)`) duplicate documentation and type work; policy ordering semantics must be maintained
in both paths.

**Policy constructors on the root export.** Rejected: couples optional policy sugar to the default
bundle; ADR 0008 subpath model keeps the main entry lean.

**Open user-extensible policy protocol in the first cutover.** Deferred: built-in policies have
known type transforms; higher-kinded typing becomes relevant only for third-party policies later.

## Consequences

- Invalid retry and delay inputs continue to surface at run time as `Err(UnhandledException)` with
  the validation error as `cause`. `RetryPolicy.retries` counts post-failure retries; custom
  `delay(retry, cause)` uses a 0-based retry index.
- Retry defaults, policy ordering with `.with(...)`, and other behavioral contracts belong in
  `packages/op/DESIGN.md`.
- Public docs use `@prodkit/op/policy` for constructors and `Delay`; core docs cover `.with(...)`.
- Keep the release overload first in the `.with(...)` type surface; this preserves contextual
  typing for `Policy.release((value) => ...)`.

## Implementation

- [#129](https://github.com/trvswgnr/prodkit/issues/129): Add typed `.with(...)` policy composition.
- [#130](https://github.com/trvswgnr/prodkit/issues/130): Add `@prodkit/op/policy` subpath (blocked by #129).
- [#131](https://github.com/trvswgnr/prodkit/issues/131): Hard-cutover from dedicated retry, timeout, and cancel methods (blocked by #129, #130).

Package boundary for the policy subpath: ADR 0008 ([#128](https://github.com/trvswgnr/prodkit/issues/128)).
