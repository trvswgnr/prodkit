# @prodkit/std

[![@prodkit/std coverage](https://img.shields.io/badge/coverage-%3E%3D94%25%20lines%20(CI)-brightgreen)](https://github.com/trvswgnr/prodkit/actions/workflows/ci.yml)

Tree-shakeable, runtime-agnostic utilities for TypeScript. Import only the subpath you need.

Op-specific features such as DI live on `@prodkit/op` subpath exports instead (see
[ADR 0008](https://github.com/trvswgnr/prodkit/blob/main/docs/adr/0008-op-subpath-exports.md)).

## What ships today

- **`@prodkit/std/di`**: dependency tokens and provisioning for composed ops. Moving to
  `@prodkit/op/di` ([#128](https://github.com/trvswgnr/prodkit/issues/128)).

Utility subpaths (`array`, `object`, `string`, and others) are planned; none ship yet.

## Dependencies

While `@prodkit/std/di` is still here, install `@prodkit/op` and `better-result` alongside
`@prodkit/std`. After the DI move, std will not require `@prodkit/op`.

## Quickstart (`DI`, until cutover)

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

After the DI move, import from `@prodkit/op/di` instead.

## Examples

[`examples/std/`](https://github.com/trvswgnr/prodkit/blob/main/examples/std/) covers DI wiring,
scoped cancellation, and pool checkout with `Op.defer`.

CI enforces coverage floors via `pnpm --filter @prodkit/std run coverage`.
