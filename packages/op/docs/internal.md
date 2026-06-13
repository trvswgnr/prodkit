# @prodkit/op/internal

Low-level exports for op extension authors: metadata, `Blocking`, `withBlocking`, `CustomInstruction`,
and related op runtime types.

Not part of the default application import surface. Typical imports:

- `Blocking`, `withBlocking`, `EmptyMeta`, `MergeMeta`, `InferOpMeta`
- `CustomInstruction` (extension hook for run-scoped state)
- `BlockingOp`, `RunContext`, `CUSTOM_INSTRUCTION_META`, and instruction surface types

Not exported here: `EnterFn` and `ExitFn` (application code uses `EnterContext` / `ExitContext` on the
main entry).

Workspace-only runtime primitives (`AbortSignalLike`, `unsafeCoerce`, `NEVER`, and similar) are
private implementation details and are not exported from this package.

The main `@prodkit/op` entry keeps consumer-facing lifecycle types (`EnterContext`, `ExitContext`)
and errors only.
