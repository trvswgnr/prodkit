# prodkit context

Shared vocabulary and documentation roles for the `prodkit` monorepo. Use this file to pick the
right doc before diving into code.

## Packages

| Package | Role |
| --- | --- |
| `@prodkit/op` | Runtime-agnostic operation library: typed async composition, policies, combinators, DI subpath |
| `@prodkit/std` | Reserved runtime-agnostic utilities (no `@prodkit/op` dependency); subpaths such as `@prodkit/std/array` planned |
| `@prodkit/shared` | Private workspace typings and config (not published) |
| `@prodkit/examples` | Consumer smoke and sample apps |
| `@prodkit/benchmarks` | Performance harnesses |
| `@prodkit/tools` | Maintainer scripts (ADR index sync, release cut, smoke harnesses) |

Op-native extension modules (DI, policy, HKT, internal helpers) ship as `@prodkit/op` subpath
exports, not separate npm packages or `@prodkit/std` modules.

## Domain vocabulary (`@prodkit/op`)

| Term | Meaning |
| --- | --- |
| **Op** | Callable operation value; generator-defined work composes with `yield*`. Public tuple arity; internally nullary at the driver. |
| **Plan** | Internal execution AST under `core/plan/`. Fluent methods, policies, combinators, and DI `provide` are plan nodes. |
| **Instruction** | Yielded discriminant the driver dispatches (`Suspend`, exit finalizer registration, `CustomInstruction`, terminal `Err`). |
| **Policy** | Retry, timeout, cancel, release, or custom attachment applied with `.with(Policy.*)` before `.run()`. |
| **Blocking** | Metadata key marking an unsatisfied requirement (for example missing DI binding) that blocks `.run()` at the type level. |
| **Settlement** | How a suspend or abort resolves (pass-through, interrupt-on-abort, drain-after-abort). |
| **UnhandledException** | Non-recoverable runtime channel from `better-result`; wraps invalid yields, cleanup faults, and validation failures. |

## Which doc to read

| Question | Start here |
| --- | --- |
| How do I install and use `@prodkit/op`? | [`packages/op/README.md`](../packages/op/README.md) (hub + core API; ships on npm) |
| Subpaths, lifecycle, cancellation depth | [`packages/op/docs/`](../packages/op/docs/README.md) (ships on npm) |
| What must stay true at run time? | [`packages/op/DESIGN.md`](../packages/op/DESIGN.md) (invariants; ships on npm) |
| Why was it built this way? | [`docs/adr/README.md`](adr/README.md) (monorepo only) |
| How does execution flow through modules? | [`docs/contributor/runtime-architecture.md`](contributor/runtime-architecture.md) |
| How do I set up, test, and release? | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| How does `@prodkit/op` compare to Effect / neverthrow? | [`packages/op/docs/comparison.md`](../packages/op/docs/comparison.md) (ships on npm) |
| What is the runtime overhead? | [`packages/op/docs/performance.md`](../packages/op/docs/performance.md) (ships on npm) |
| What changed in the last release? | Package `CHANGELOG.md` under `packages/op` or `packages/std` |

## Documentation boundaries

- **Consumer docs** (`packages/op/README.md`, `packages/op/docs/`, `DESIGN.md`, changelogs): outcome-focused usage and stable semantics. Avoid issue checklists and migration status.
- **ADRs** (`docs/adr/`): evergreen decision records (why). Track implementation in GitHub issues, not ADR bodies.
- **Contributor docs** (`CONTRIBUTING.md`, `docs/contributor/`): setup, gate, release, and code navigation. Not duplicated in package READMEs.
- **Agent memory** (`AGENTS.md`): durable workspace facts for automation; not consumer-facing.

When behavior changes, update the consumer-facing doc first, then `DESIGN.md` invariants if needed,
then add or supersede an ADR when the decision itself changed.
