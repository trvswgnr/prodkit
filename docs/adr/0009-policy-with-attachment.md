---
status: proposed
title: Policy attaches via .with(Policy.*)
packages:
  - "@prodkit/op"
---

# Policy attaches via .with(Policy.*)

ADR 0006 established args-only `.run()` and fluent policy composition on the op value. The public
surface still exposes dedicated methods (`.withRetry()`, `.withTimeout()`, `.withSignal()`,
`.withRelease()`). Policy constructors and delay helpers also live on the root `@prodkit/op`
export today.

## Decision

**Single attachment surface.** Policies compose through `.with(policy)` on the op value:

```ts
import { Delay } from "@prodkit/op/policy";
import * as Policy from "@prodkit/op/policy";

acquireConnection
  .with(Policy.timeout(1_000))
  .with(Policy.retry({ attempts: 3, delay: Delay.exponential({ baseMs: 100, maxMs: 1_000 }) }))
  .with(Policy.signal(signal))
  .with(Policy.release((conn) => conn.close()));
```

Dedicated fluent policy methods are removed after the new surface is in place (hard cutover).

**Constructors on `@prodkit/op/policy`.** Policy constructors (`Policy.retry`, `Policy.timeout`,
`Policy.signal`, `Policy.release`), `Delay`, and related public types ship on the policy subpath
per ADR 0008. The main entry owns `.with(...)`, policy ordering, plan application, runtime
behavior, and `TimeoutError`.

**Lifecycle and transforms stay on `Op`.** Do not move `on(...)`, `map(...)`, `mapErr(...)`,
`flatMap(...)`, `tap(...)`, `tapErr(...)`, or `recover(...)` under `Policy`.

## Release typing spike

Before committing `Policy.release(...)`, verify contextual typing:

```ts
acquireConnection.with(Policy.release((conn) => conn.close()));
```

`conn` must infer from the source op success type. If TypeScript cannot preserve that inference,
keep `.withRelease(...)` as a dedicated method and move only retry, timeout, and signal to
`Policy`.

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
  the validation error as `cause`.
- Retry defaults, policy ordering with `.with(...)`, and other behavioral contracts belong in
  `packages/op/DESIGN.md` once implemented.
- Public docs use `@prodkit/op/policy` for constructors and `Delay`; core docs cover `.with(...)`.

## Implementation

- [#129](https://github.com/trvswgnr/prodkit/issues/129): Add typed `.with(...)` policy composition.
- [#130](https://github.com/trvswgnr/prodkit/issues/130): Add `@prodkit/op/policy` subpath (blocked by #129).
- [#131](https://github.com/trvswgnr/prodkit/issues/131): Hard-cutover from dedicated fluent policy methods (blocked by #129, #130).

Package boundary for the policy subpath: ADR 0008 ([#128](https://github.com/trvswgnr/prodkit/issues/128)).
