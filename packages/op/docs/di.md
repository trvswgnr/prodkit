# @prodkit/op/di

Dependency injection for composed ops: tokens, `inject`, `provide`, and scoped/singleton bindings.

```ts
import { Op } from "@prodkit/op";
import { DI } from "@prodkit/op/di";

interface Database {
  findById(id: number): Promise<{ id: number } | null>;
}

class DatabaseDependency extends DI.Dependency("Database")<Database> {}

const db: Database = {
  findById: async (id) => ({ id }),
};

const getUser = Op(function* (id: number) {
  const database = yield* DI.inject(DatabaseDependency);
  return yield* database.findById(id);
});

const runnable = DI.provide(getUser, [DI.singleton(DatabaseDependency, db)]);
const result = await runnable.run(1);
```

## Public exports

`DI` (including `DI.MissingDependencyError` and `DI.DuplicateDependencyError`), top-level
`Dependency`, `inject`, `provide`, `scoped`, `singleton`, and `RequiredDeps`.

## Compile time

An op that uses `DI.inject` cannot be `.run()` until you satisfy bindings with `DI.provide(...)`
(or partial `provide` while requirements remain). TypeScript surfaces missing dependencies through
`RequiredDeps` and by omitting `.run()` on the op type until they are provided.

## Token identity

Each dependency slot is the token **class** you declare and pass to `DI.inject` / `DI.singleton` /
`DI.scoped`. The string passed to `DI.Dependency("...")` is a diagnostic label for errors only;
two classes may share the same label and remain separate slots.

## Run time

If you call `.run()` without a required binding, or provide the same token class twice, the run
fails with `Err(UnhandledException)` from `better-result`. The DI-specific fault is on `error.cause`,
not on the op's typed error channel `E`:

```ts
import { UnhandledException } from "better-result";
import { Op } from "@prodkit/op";
import { DI } from "@prodkit/op/di";

class DatabaseDependency extends DI.Dependency("Database")<unknown> {}

const op = Op(function* () {
  yield* DI.inject(DatabaseDependency);
  return "unreachable";
});

const result = await op.run();
if (result.isErr() && UnhandledException.is(result.error)) {
  const { cause } = result.error;
  if (DI.MissingDependencyError.is(cause)) {
    console.error(`missing binding: ${cause.key}`);
  } else if (DI.DuplicateDependencyError.is(cause)) {
    console.error(`duplicate binding: ${cause.key}`);
  }
}
```

## Examples

Runnable consumer examples live under
[`examples/op/di/`](https://github.com/trvswgnr/prodkit/blob/main/examples/op/di/) (onboarding,
scoped cancellation, HTTP handler with pool checkout).
