# @prodkit/op-lint

Lint rules for `@prodkit/op` generator composition. The package exports a plain
ESLint-compatible plugin object and can be loaded by Oxlint through JavaScript plugins.
Compatibility is tested against ESLint RuleTester and Oxlint JavaScript plugin loading.

## Install

```bash
pnpm add -D @prodkit/op-lint oxlint typescript
```

## Oxlint

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

Oxlint JavaScript plugins are alpha in Oxlint. Keep the plugin and Oxlint versions tested together
when upgrading.

## Rules

### `require-yield-star`

Reports `Op`-typed expressions inside generator bodies when the returned operation is not composed
with `yield*`.

```ts
import { Op } from "@prodkit/op";

const invalid = Op(function* () {
  Op.of(1);
});

const valid = Op(function* () {
  return yield* Op.of(1);
});
```

The rule uses TypeScript checker information to recognize `@prodkit/op` values, including aliases,
imported operations, generic `Op` parameters, properties, and methods returning Ops. When type
information is unavailable, it still catches direct `Op.<builder>(...)` expression statements.
