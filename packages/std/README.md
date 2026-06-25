# @prodkit/std

**Reserved.** `@prodkit/std` is a published package reserved for tree-shakeable, runtime-agnostic
utilities with no `@prodkit/op` dependency. The entrypoint intentionally exports no utilities.

Op-specific features such as DI, policy, HKT, and op-native policies live on `@prodkit/op` subpath
exports when they are runtime-agnostic and depend only on op and `better-result`. Platform-specific
or integration-SDK code (OpenTelemetry, Node CLI adapters) ships as separate `@prodkit/*` packages.
See the [`@prodkit/op` README](https://github.com/trvswgnr/prodkit/tree/main/packages/op#readme).

The [`examples/std/`](https://github.com/trvswgnr/prodkit/blob/main/examples/std/) directory is a
reserved placeholder for consumer samples.
