# @prodkit/op-lint

Lint rules for `@prodkit/op` generator composition. The package exports a plain
ESLint-compatible plugin object and can be loaded by Oxlint through JavaScript plugins.
Compatibility is tested against ESLint RuleTester and Oxlint JavaScript plugin loading.

## Install

```bash
pnpm add -D @prodkit/op-lint oxlint
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

Reports direct calls to known `Op` builders inside generator bodies when the returned operation is
not composed with `yield*`.

```ts
import { Op } from "@prodkit/op";

const invalid = Op(function* () {
  Op.of(1);
});

const valid = Op(function* () {
  return yield* Op.of(1);
});
```

The rule is syntax-only: it catches direct `Op.<builder>(...)` expression statements in generator
functions. It does not do type-aware import, alias, or custom builder analysis.
