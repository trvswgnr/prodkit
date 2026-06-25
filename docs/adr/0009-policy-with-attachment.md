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
import { Delay, Policy } from "@prodkit/op/policy";

acquireConnection
  .with(Policy.timeout(1_000))
  .with(Policy.retry({ retries: 2, delay: Delay.exponential({ baseMs: 100, maxMs: 1_000 }) }))
  .with(Policy.cancel(signal))
  .with(Policy.release((conn) => conn.close()));
```

Dedicated retry, timeout, cancel, and release methods were removed (hard cutover).

**Constructors on `@prodkit/op/policy`.** Policy constructors (`Policy.retry`, `Policy.timeout`,
`Policy.cancel`, `Policy.release`), `Delay`, and related public types ship on the policy subpath
per ADR 0008. The main entry owns `.with(...)`, policy ordering, plan application, runtime behavior,
and `TimeoutError`.

**Lifecycle and transforms stay on `Op`.** Do not move `on(...)`, `map(...)`, `mapErr(...)`,
`flatMap(...)`, `tap(...)`, `tapErr(...)`, or `recover(...)` under `Policy`.

**Release overload is first in the `.with(...)` type surface.** That preserves contextual typing for
`Policy.release((value) => ...)`. When the release overload is last, TypeScript infers the callback
parameter as `unknown`.

## Considered options

**Keep dedicated fluent methods only.** Rejected: two parallel surfaces (methods plus `.with(...)`)
duplicate documentation and type work; policy ordering semantics must be maintained in both paths.

**Policy constructors on the root export.** Rejected: couples optional policy sugar to the default
bundle; ADR 0008 subpath model keeps the main entry lean.

**Open user-extensible policy protocol in the first cutover.** Initially deferred for the
hard cutover; shipped afterward via `Policy.define(...)` and `@prodkit/op/hkt` (see consequences).

## Consequences

- Invalid retry and delay inputs continue to surface at run time as `Err(UnhandledException)` with
  the validation error as `cause`. `RetryPolicy.retries` counts post-failure retries; custom
  `delay(retry, cause)` uses a 0-based retry index.
- The open policy protocol (`Policy.define`, `@prodkit/op/hkt`) is part of the public surface; custom
  attachments can describe type-level op transforms without core `.with` overloads.
- Retry defaults, policy ordering with `.with(...)`, and other behavioral contracts belong in
  `docs/contributor/op-invariants.md`.
- Public docs use `@prodkit/op/policy` for constructors and `Delay`; core docs cover `.with(...)`.
- Package boundary for the policy subpath: [ADR 0008](0008-op-subpath-exports.md).
