# @prodkit/std

Companion standard library for `@prodkit/op` programs. Modules are runtime-agnostic and usually build on `Op`, but Op integration is not required for every module.

## Dependencies

`@prodkit/std` declares peer dependencies on `@prodkit/op` (`^0.1.0`) and `better-result` (`^2.9.0`).
Install compatible versions of all three packages in the same application.

`@prodkit/std` does not re-export `better-result` types. When you handle `.run()` results from
dependency-aware ops, import `Result` and `UnhandledException` from `better-result` the same way as
for plain `@prodkit/op` programs. For which `better-result` symbols are part of the public contract,
peer range notes, and what ships from `@prodkit/op` itself, see
[Dependencies (`better-result`)](https://github.com/trvswgnr/prodkit/blob/main/packages/op/README.md#dependencies-better-result)
in the `@prodkit/op` README.

## Scope

### Today

- **`DI`** (`@prodkit/std/di`): yieldable dependency tokens, bindings, and provisioning for composed ops.

### Likely future modules

These are directions under consideration, not commitments or release dates. The package name stays `@prodkit/std` (no `@prodkit/di` split).

- **Tracing**: span context and propagation helpers for composed `Op` programs.
- **Typed env/config**: runtime-agnostic configuration reading and validation.

## Quickstart (`DI`)

```ts
import { Op } from "@prodkit/op";
import { DI } from "@prodkit/std/di";

interface Database {
  query: Op<unknown, DatabaseError, [sql: string, params: unknown[]]>;
}

class DatabaseDependency extends DI.Dependency("DatabaseDependency")<Database> {}

const getUser = Op(function* () {
  const db = yield* DI.inject(DatabaseDependency);
  return yield* db.query("select * from users where id = ?", [1]);
});

const runnable = DI.provide(getUser, DI.singleton(DatabaseDependency, db));
const result = await runnable.run();
```

Lifetimes:

- `DI.singleton(Dependency, value)` binds one value reused across runs.
- `DI.scoped(Dependency, resolve)` resolves once per op run and caches for that run. The factory
  receives the run `AbortSignal` (same contract as `Op.try`) and may return a value or
  `PromiseLike`. When the signal is already aborted at inject time, the factory is not called.
  Async factories are awaited with DI-native abort handling; abort before settlement leaves the
  binding uncached. After a successful resolve, the cached value stays for the rest of that run
  even if the signal aborts later.
- `DI.provide(op, new DependencyImpl())` binds a class instance directly when an implementation class extends the dependency token.

```ts
const op = DI.provide(
  getUser,
  DI.scoped(DatabaseDependency, (signal) => connectDatabase(signal)),
);

// same run uses one resolved instance
await op.run();

// next run resolves again
await op.run();
```

The root package is intended for namespace imports:

```ts
import * as std from "@prodkit/std";

const Dependency = std.DI.Dependency("Dependency");
```

## Examples in this repo

End-to-end DI wiring with `DI` dependencies lives in [`examples/std/onboarding.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/std/onboarding.ts) (consumer smoke covers it via [`examples/smoke.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/smoke.ts)).
