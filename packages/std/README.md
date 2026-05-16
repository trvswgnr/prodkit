# @prodkit/std

Standard library utilities for `@prodkit/op`.

```ts
import { Ctx } from "@prodkit/std/di";
import { Op } from "@prodkit/op";

interface Database {
  query: Op<unknown, DatabaseError, [sql: string, params: unknown[]]>;
}

class DatabaseService extends Ctx.Service("DatabaseService")<Database> {}

const getUser = Ctx.Op(function* () {
  const db = yield* Ctx.require(DatabaseService);
  return yield* db.query("select * from users where id = ?", [1]);
});

const runnable = getUser.use(DatabaseService.of(db));
const result = await runnable.run();
```

The root package is intended for namespace imports:

```ts
import * as std from "@prodkit/std";

const Service = std.di.Ctx.Service("Service");
```
