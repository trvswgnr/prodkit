# @prodkit/op-lint

Catches the most common `@prodkit/op` mistakes before they turn into runtime bugs. The plugin
works in both Oxlint and ESLint, with the same rule name in either linter.

## Why use it

Inside an `Op(function* () { ... })` body, a child Op runs when it is composed with `yield*`. The
easy mistakes all look valid to TypeScript but do the wrong thing for Op composition:

```ts
import { Op } from "@prodkit/op";

const ignored = Op(function* () {
  Op.of(1);
});

const returned = Op(function* () {
  return Op.of(1);
});

const yielded = Op(function* () {
  yield Op.of(1);
});

const awaited = Op(async function* () {
  await Op.of(1);
});
```

`@prodkit/op-lint` reports those patterns and, when the rewrite is mechanical, can fix them to
`yield*`.

```ts
import { Op } from "@prodkit/op";

const valid = Op(function* () {
  const value = yield* Op.of(1);
  const staged = Op.of(value + 1);

  return yield* staged;
});
```

## Install

```bash
pnpm add -D @prodkit/op-lint oxlint typescript
```

`typescript` is a peer dependency because the rule uses the TypeScript checker to recognize real
`@prodkit/op` values.

## Use with Oxlint

Add the package as an Oxlint JavaScript plugin and enable `prodkit-op/require-yield-star`.

```json
{
  "jsPlugins": [
    {
      "name": "prodkit-op",
      "specifier": "@prodkit/op-lint"
    }
  ],
  "rules": {
    "prodkit-op/require-yield-star": "error"
  }
}
```

The same setup works in `oxlint.config.ts`:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: [
    {
      name: "prodkit-op",
      specifier: "@prodkit/op-lint",
    },
  ],
  rules: {
    "prodkit-op/require-yield-star": "error",
  },
});
```

Oxlint JavaScript plugins are alpha in Oxlint, so keep plugin and Oxlint upgrades tested together.

## Use with ESLint

ESLint flat config can load the same package as a normal plugin object.

```js
import prodkitOp from "@prodkit/op-lint";

export default [
  {
    plugins: {
      "prodkit-op": prodkitOp,
    },
    rules: {
      "prodkit-op/require-yield-star": "error",
    },
  },
];
```

## Rule behavior

### `prodkit-op/require-yield-star`

Reports Op values inside `Op(function* () { ... })` bodies, including checker-resolved aliases of
the `Op` factory, when they are not composed with `yield*`.

The rule reports:

- Direct Op expression statements, such as `Op.of(1);`
- Returned Ops, such as `return loadUser();`
- Non-delegating yields, such as `yield loadUser();`
- Awaited Ops, such as `await loadUser();`

The rule allows:

- `return yield* loadUser();`
- Staging an Op in a local variable before later `yield*` composition
- Plain generators that are not passed to the `@prodkit/op` factory
- Ops returned from non-generator callbacks
- Non-Op iterables and structural lookalikes that do not come from `@prodkit/op`

## Type detection

The rule detects direct `Op.<builder>(...)` calls even without checker information. With TypeScript
resolution available, it also recognizes aliased Op factory names, imported operations, generic `Op`
parameters, properties typed as Ops, and methods returning Ops.

The detector is conservative. Type-aware matches require TypeScript to resolve the linted file and
`@prodkit/op` from the nearest `tsconfig.json`; without a config, the plugin falls back to an
inferred NodeNext project. Expressions typed as `any` or `unknown` are not reported from type
information, and objects that merely look like Ops are ignored unless their Op identity comes from
`@prodkit/op`.
