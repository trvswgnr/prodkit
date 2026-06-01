# @prodkit/op/internal

Low-level exports for op extension authors: metadata, `Blocking`, `withBlocking`, `CustomInstruction`,
`AbortSignalLike`, and related helpers.

Not part of the default application import surface. Typical imports:

- `Blocking`, `withBlocking`, `EmptyMeta`, `MergeMeta`, `InferOpMeta`
- `CustomInstruction` (extension hook for run-scoped state)
- `BlockingOp`, `AbortSignalLike`, `unsafeCoerce`, `NEVER`

The main `@prodkit/op` entry keeps consumer-facing lifecycle types (`EnterContext`, `ExitContext`)
and errors only.

For how extensions integrate with the driver, see the monorepo guide
[`docs/contributor/runtime-architecture.md`](https://github.com/trvswgnr/prodkit/blob/main/docs/contributor/runtime-architecture.md).
