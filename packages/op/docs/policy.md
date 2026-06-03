# @prodkit/op/policy

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

## Public exports

Values: `Policy`, `Delay`.

Types: `Policy` (custom policy values and factories), `Policy.Input`, `Policy.Source`, `Policy.Type`,
`Policy.BuiltIn`, `RetryPolicy`, `Delay` (retry delay configuration), `ExponentialDelayOptions`,
`RetryPolicyAttachment`, `TimeoutPolicyAttachment`, `CancelPolicyAttachment`,
`ReleasePolicyAttachment`, `TimeoutPolicyType`.

Built-in attachments use `Policy.retry`, `Policy.timeout`, `Policy.cancel`, and `Policy.release`.
Custom policies use `Policy.define(...)`. Custom policies that transform `Op<T, E, A, M>` at the
type level use the HKT protocol; import `HKT` from `@prodkit/op/hkt` (see [hkt.md](hkt.md)), not
from this subpath.

## Ordering

Policy ordering semantics are summarized under [`.with(policy)`](../README.md#withpolicy) and
[Retry defaults](../README.md#retry-defaults) in the package README.
