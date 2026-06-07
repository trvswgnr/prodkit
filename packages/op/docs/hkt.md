# @prodkit/op/hkt

Reusable higher-kinded type encoding for modules that need an open type-level transform. Policy
uses it to let custom `.with(...)` attachments describe how they transform `Op<T, E, A, M>` without
adding overloads to core.

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

type HttpResult<A> = HKT.Apply<HKT.Fix1<EitherF, { status: number }>, readonly [A]>;
//   ^? Either<{ status: number }, A>
```

Policy uses the same encoding: `[HKT.TYPE]` is `Op<...>`, args are `[T, E, A, M]`, and
`Policy.timeout(...)` widens `E` with `TimeoutError` without a core `.with` overload.

## Public export

`HKT` (interface, namespace, and frozen `{ PARAMS, TYPE }` symbol constants). Namespace members:
`HKT.Param`, `HKT.Apply`, `HKT.Compose`, `HKT.Flip`, `HKT.Fix1`, `HKT.Fix2`, and `HKT.Fix12`.

Import from here for custom `Policy.define(...)` attachments and other op extensions; the policy
subpath does not re-export these symbols.

## Custom policy checklist

1. Import `Policy` from `@prodkit/op/policy` and `HKT` from `@prodkit/op/hkt` (policy does not
   re-export HKT).
2. Declare a policy HKT with `[HKT.TYPE]: Op<...>` describing how the attachment transforms
   `Op<T, E, A, M>` (for example widening `E` with a domain error).
3. Return `Policy.define(...)` from a factory typed as `Policy<unknown, YourPolicyHKT>`; use
   `source.wrap`, `source.rewrite`, or `source.around` inside `apply`.
4. Attach with `.with(yourPolicy(...))` before `.run()`.

Runnable walkthrough:
[`examples/op/custom-policy/sample.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/custom-policy/sample.ts).
Type-level coverage lives in
[`policy/hkt.test.ts`](https://github.com/trvswgnr/prodkit/blob/main/packages/op/tests/unit/policy/hkt.test.ts).
