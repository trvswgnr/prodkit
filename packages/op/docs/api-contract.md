# @prodkit/op API contract

Authoritative export inventory for the beta freeze. Signatures match the built declaration files
under `dist/` after `pnpm --filter @prodkit/op run build`. Export names are verified against the
source entrypoints monitored by `changelog:api:check` and `api:manifest:check`
(`packages/op/public-api.manifest.json`).

`better-result` types (`Result`, `Err`, `Ok`, and related helpers) are a **peer dependency**.
Import them from `better-result` directly; they are not re-exported from `@prodkit/op` (ADR 0015).

## Tiers

| Tier | Import path | Audience |
| --- | --- | --- |
| Application | `@prodkit/op`, `@prodkit/op/di`, `@prodkit/op/policy`, `@prodkit/op/hkt` | Application and library code |
| Extension-author | `@prodkit/op/internal` | Op extension authors only; not for application imports |

All tiers are semver-governed from `0.2.0`. Extension-author exports are stable but
documented as a separate contract tier.

---

## Application tier: `@prodkit/op`

Entry: `dist/index.d.mts` (re-exports from the main build graph).

### Values

| Export | Signature |
| --- | --- |
| `Op` | Callable operation factory plus static namespace (see below) |
| `ErrorGroup` | `class ErrorGroup<E> extends AggregateError` with `errors: E[]`, `static is(value: unknown): value is ErrorGroup<unknown>` |
| `TimeoutError` | `class TimeoutError` with `constructor({ timeoutMs }: { timeoutMs: number })` |

### Types

| Export | Signature |
| --- | --- |
| `Op` | `type Op<T, E, A, M = EmptyMeta> = OpInterface<T, E, A, M> & Tagged<"Op">` |
| `EnterContext` | `interface EnterContext<A = []> { readonly signal: AbortSignal; readonly args: A }` |
| `ExitContext` | `interface ExitContext<T, E, A = []> { readonly signal: AbortSignal; readonly args: A; readonly result: Result<T, E \| UnhandledException> }` |
| `OpLifecycleHook` | `type OpLifecycleHook = "enter" \| "exit"` |

### `Op` factory (static namespace)

`Op` is `typeof fromGenFn` intersected with:

| Member | Signature |
| --- | --- |
| `_tag` | `"OpFactory"` |
| `run` | `<T, E, A, M>(op: RunnableOp, ...args: AsArgs<A>) => Promise<Result<T, E \| UnhandledException>>` |
| `of` | `<T>(value: T \| PromiseLike<T>) => Op<Awaited<T>, never, [], EmptyMeta>` |
| `fail` | `<E>(value: E) => Op<never, E, [], EmptyMeta>` |
| `defer` | `(finalize: AnyExitFn) => Op<void, never, [], EmptyMeta>` |
| `sleep` | `(ms: number) => Op<void, never, [], EmptyMeta>` |
| `try` | `<T, E = UnhandledException>(f: (signal: AbortSignal) => T, onError?: (e: unknown) => E \| PromiseLike<E>) => Op<Awaited<T>, TrackedErr<Awaited<E>>, [], EmptyMeta>` |
| `all` | `<const Ops extends readonly AnyNullaryOp[]>(ops: Ops, concurrency?: number) => Op<...>` |
| `allSettled` | `<const Ops extends readonly AnyNullaryOp[]>(ops: Ops, concurrency?: number) => Op<...>` |
| `settle` | `<T, E, M>(op: Op<T, E, [], M>) => Op<Result<T, E \| UnhandledException>, never, [], M>` |
| `any` | `<const Ops extends readonly AnyNullaryOp[]>(ops: Ops) => Op<...>` |
| `race` | `<const Ops extends readonly AnyNullaryOp[]>(ops: Ops) => Op<...>` |
| `empty` | `Op<void, never, [], EmptyMeta>` |

`Op(...)` callable: `<Y, T, A>(f: (...args: AsArgs<A>) => Generator<Y, T, unknown>) => Op<T, InferInstructionErr<Y>, A, InferInstructionMeta<Y>>`.

### `Op` instance interface

Every `Op<T, E, A, M>` instance provides:

| Member | Signature |
| --- | --- |
| `_tag` | `"Op"` |
| `(...args)` | `(...args: AsArgs<A>) => Op<T, E, [], M>` |
| `run` | When `IsRunnable<M>`: `(...args: AsArgs<A>) => Promise<Result<T, E \| UnhandledException>>`; otherwise unavailable |
| `with` | `<F extends HKT>(policy: OpPolicy<OpPolicyInput<T, E, AsArgs<A>, M>, F>) => HKT.Apply<F, [T, E, AsArgs<A>, M]>` |
| `on` | `(event: "enter", initialize: EnterFn<A>) => Op<T, E, A, M>` or `(event: "exit", finalize: ExitFn<T, E, A>) => Op<T, E, A, M>` |
| `map` | `<U>(transform: (value: T) => U) => Op<Awaited<U>, E, A, M>` |
| `mapErr` | `<E2>(transform: (error: TrackedErr<E>) => E2) => Op<T, E2 \| BypassedErr<E>, A, M>` |
| `flatMap` | `<R extends AnyNullaryOp>(bind: (value: T) => R) => Op<InferOpOk<R>, E \| InferOpErr<R>, A, MergeMeta<M, InferOpMeta<R>>>` |
| `tap` | `<R>(observe: (value: T) => R) => Op<T, E, A, M>` |
| `tapErr` | `<R>(observe: (error: TrackedErr<E>) => R) => Op<T, TrackedErr<E> \| BypassedErr<E>, A, M>` |
| `recover` | `<ECaught, R>(predicate: (error: TrackedErr<E>) => error is ECaught, handler: (error: ECaught) => R) => Op<T \| Awaited<R>, TrackedErr<E, ECaught> \| BypassedErr<E>, A, M>` |
| `[Symbol.iterator]` | Present when `A extends []`; yields `Instruction<E, M>` |

Policy attachments use `import { Policy } from "@prodkit/op/policy"`.

---

## Application tier: `@prodkit/op/di`

Entry: `dist/di/index.d.mts`.

### Values

| Export | Signature |
| --- | --- |
| `Dependency` | `<const Name extends string>(key: Name) => DependencyCtor<Name>` |
| `inject` | `<C extends AnyDependency>(dependency: C) => Generator<InjectInstruction<...>, DependencyValue<C>, unknown>` |
| `singleton` | `<C, V>(dependency: C, value: DependencyValue<C, V>) => SingletonBinding<C, V>` |
| `scoped` | `<C>(dependency: C, resolve: LazyResolveFn<C>) => LazyBinding<C>` |
| `provide` | `<T, E, A, M, const Bindings>(op: Op<T, E, A, M>, bindings: ValidProvideBindings<Bindings, ...>) => Op<T, E, A, ProvidedMeta<M, Bindings>>` |
| `DI` | Namespace: `{ Dependency, inject, singleton, scoped, provide, MissingDependencyError, DuplicateDependencyError }` |

### Types

| Export | Signature |
| --- | --- |
| `Dependency` | `interface Dependency<T, Name extends string> { readonly _tag: typeof DI_TAG; readonly key: Name; readonly [DI_TOKEN]: T }` |
| `RequiredDeps` | `type RequiredDeps<C> = ...` (unsatisfied dependency tokens blocking `.run()` on an op) |

`MissingDependencyError` and `DuplicateDependencyError` are reachable as `DI.MissingDependencyError`
and `DI.DuplicateDependencyError`.

---

## Application tier: `@prodkit/op/policy`

Entry: `dist/policy/index.d.mts`.

### Values

| Export | Signature |
| --- | --- |
| `Policy` | `{ retry, timeout, cancel, release, define }` (see below) |
| `Delay` | `{ fixed, exponential, immediate, defaultRetry }` |

| `Policy` member | Signature |
| --- | --- |
| `retry` | `(policy?: RetryPolicy) => RetryPolicyAttachment` |
| `timeout` | `(timeoutMs: number) => TimeoutPolicyAttachment` |
| `cancel` | `(abortSignal: AbortSignal) => CancelPolicyAttachment` |
| `release` | `<T>(releaseFn: ReleaseFn<T>) => ReleasePolicyAttachment<T>` |
| `define` | `<Input, F, Extras>(definition: { apply(source): HKT.Apply<F, ...> } & Extras) => OpPolicy<Input, F> & Extras` |

### Types

| Export | Signature |
| --- | --- |
| `Policy` | `type Policy<Input = unknown, F extends HKT = OpPolicyType> = OpPolicy<Input, F>` |
| `Policy.Input` | `type Input<T, E, A, M> = OpPolicyInput<T, E, A, M>` |
| `Policy.Source` | `type Source<T, E, A, M> = OpPolicySource<T, E, A, M>` |
| `Policy.Type` | `type Type = OpPolicyType` |
| `Policy.BuiltIn` | `type BuiltIn<T> = BuiltInPolicy<T>` |
| `CancelPolicyAttachment` | Built-in cancel policy attachment type |
| `Delay` | `type Delay = number \| ((retry: number, cause: unknown) => number)` |
| `ExponentialDelayOptions` | `{ baseMs?: number; maxMs?: number; jitter?: number }` |
| `ReleasePolicyAttachment` | Built-in release policy attachment type |
| `RetryPolicy` | `{ retries?: number; when?: (cause: unknown) => boolean; delay?: Delay }` |
| `RetryPolicyAttachment` | Built-in retry policy attachment type |
| `TimeoutPolicyAttachment` | Built-in timeout policy attachment type |
| `TimeoutPolicyType` | Timeout policy HKT |

---

## Application tier: `@prodkit/op/hkt`

Entry: `dist/hkt.d.mts`.

### Values

| Export | Signature |
| --- | --- |
| `HKT` | `Readonly<{ PARAMS: unique symbol; TYPE: unique symbol }>` |

### Types

| Export | Signature |
| --- | --- |
| `HKT` | `interface HKT extends HKT.Parameterized<readonly unknown[]>` |
| `HKT.PARAMS` | `typeof PARAMS` |
| `HKT.TYPE` | `typeof TYPE` |
| `HKT.Parameterized` | `interface Parameterized<Args extends readonly unknown[]>` |
| `HKT.Param` | `type Param<Self, N>` |
| `HKT.Applied` | `type Applied<F, Args>` |
| `HKT.Apply` | `type Apply<F, Args>` |
| `HKT.Compose` | `interface Compose<F, G> extends HKT` |
| `HKT.Flip` | `interface Flip<F> extends HKT` |
| `HKT.Fix1` | `interface Fix1<F, A> extends HKT` |
| `HKT.Fix2` | `interface Fix2<F, B> extends HKT` |
| `HKT.Fix12` | `interface Fix12<F, A, B> extends HKT` |

---

## Extension-author tier: `@prodkit/op/internal`

Entry: `dist/internal/index.d.mts`. **Not for application imports.**

### Values

| Export | Signature |
| --- | --- |
| `CUSTOM_INSTRUCTION_META` | `unique symbol` |
| `withBlocking` | `<T, E, A, M, const K, P>(op: Op<T, E, A, M>, _key: K) => BlockingOp<T, E, A, M, K, P>` |

### Types

| Export | Signature |
| --- | --- |
| `AnyNullaryOp` | `Op<any, any, [], any>` |
| `Blocking` | `type Blocking<T> = { readonly [BLOCKING]: T }` |
| `BlockingOp` | `Op<T, E, A, SetBlockingMeta<M, K, P>>` |
| `CustomInstruction` | `interface CustomInstruction<T, M = EmptyMeta>` with `resolve(context: RunContext): T \| PromiseLike<T>` and `[Symbol.iterator]()` |
| `EmptyMeta` | Empty metadata (merge identity) |
| `InferInstructionErr` | Instruction error inference helper |
| `InferInstructionMeta` | Instruction metadata inference helper |
| `InferOpMeta` | Op metadata inference helper |
| `Instruction` | `Err \| SuspendInstruction \| RegisterExitFinalizerInstruction \| CustomInstruction` |
| `IsRunnable` | Runnable gating from metadata |
| `MergeMeta` | Metadata merge algebra |
| `RunContext` | `interface RunContext<A> { readonly signal: AbortSignal; readonly args: A; readonly extensions: ReadonlyMap<unknown, unknown> }` |
| `SetBlockingMeta` | Attach `Blocking` at a metadata key |
