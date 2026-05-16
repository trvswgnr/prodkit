# @prodkit/std

Standard library utilities for `@prodkit/op`.

```ts
import { DI } from "@prodkit/std/di";
import { Op } from "@prodkit/op";

interface Database {
  query: Op<unknown, DatabaseError, [sql: string, params: unknown[]]>;
}

class DatabaseDependency extends DI.Dependency("DatabaseDependency")<Database> {}

const getUser = DI.Op(function* () {
  const db = yield* DI.require(DatabaseDependency);
  return yield* db.query("select * from users where id = ?", [1]);
});

const runnable = getUser.use(DI.singleton(DatabaseDependency, db));
const result = await runnable.run();
```

Lifetimes:

- `DI.singleton(Dependency, value)` binds one value reused across runs.
- `DI.scoped(Dependency, resolve)` resolves once per op run and caches for that run.
- `op.use(new DependencyImpl())` binds a class instance directly (useful when an implementation class extends the dependency token).

```ts
const op = getUser.use(
  DI.scoped(DatabaseDependency, () => connectDatabase()),
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
