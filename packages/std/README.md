# @prodkit/std

Tree-shakeable, runtime-agnostic utilities for TypeScript. Import only the subpath you need.

Op-specific features such as DI live on `@prodkit/op` subpath exports instead (see
[ADR 0008](https://github.com/trvswgnr/prodkit/blob/main/docs/adr/0008-op-subpath-exports.md)).

## What ships today

Utility subpaths (`array`, `object`, `string`, and others) are planned; none ship yet.

For dependency injection with composed ops, use `@prodkit/op/di`:

```ts
import { Op } from "@prodkit/op";
import { DI } from "@prodkit/op/di";

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

## Examples

DI consumer examples live under
[`examples/op/di/`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/di/). The
[`examples/std/`](https://github.com/trvswgnr/prodkit/blob/main/examples/std/) directory is
reserved for future `@prodkit/std` utility samples.
