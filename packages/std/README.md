# @prodkit/std

Standard library utilities for `@prodkit/op`.

```ts
import { Context, withContext } from "@prodkit/std/di";
import { Op } from "@prodkit/op";

interface Database {
  query: Op<unknown, DatabaseError, [sql: string, params: unknown[]]>;
}

class DatabaseService extends Context("DatabaseService")<Database> {}

const getUser = withContext(function* () {
  const db = yield* Context.require(DatabaseService);
  return yield* db.query("select * from users where id = ?", [1]);
});

const runnable = getUser.provide(DatabaseService, db);
const result = await runnable.run();
```

The root package is intended for namespace imports:

```ts
import * as std from "@prodkit/std";

const Service = std.di.Context("Service");
```
