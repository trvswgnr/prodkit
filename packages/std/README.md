# @prodkit/std

Standard library utilities for `@prodkit/op`.

```ts
import { DI } from "@prodkit/std/di";
import { Op } from "@prodkit/op";

interface Database {
  query: Op<unknown, DatabaseError, [sql: string, params: unknown[]]>;
}

class DatabaseService extends DI.Service("DatabaseService")<Database> {}

const getUser = DI.Op(function* () {
  const db = yield* DI.require(DatabaseService);
  return yield* db.query("select * from users where id = ?", [1]);
});

const runnable = getUser.use(DatabaseService.of(db));
const result = await runnable.run();
```

The root package is intended for namespace imports:

```ts
import * as std from "@prodkit/std";

const Service = std.di.DI.Service("Service");
```

## Examples in this repo

End-to-end DI wiring with `DI` services lives in [`examples/std/onboarding.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/std/onboarding.ts) (consumer smoke covers it via [`examples/smoke.ts`](https://github.com/trvswgnr/prodkit/blob/main/examples/smoke.ts)).
