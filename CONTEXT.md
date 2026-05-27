# prodkit

Runtime-agnostic effect composition library (`@prodkit/op`) with a companion standard library (`@prodkit/std`) for cross-cutting concerns like dependency injection.

## Language

### Dependency injection (`@prodkit/std/di`)

**Dependency**:
A typed token representing a required capability (for example a database or logger). Ops declare requirements via `DI.inject`; callers satisfy them via `DI.provide`.
_Avoid_: Service, bean, provider (without qualification)

**Binding**:
A provision entry that maps a dependency token to a value or factory. Lifetimes are expressed through binding kind, not separate vocabulary.
_Avoid_: Registration, wiring (as a noun for the entry itself)

**Singleton binding**:
A binding that reuses one resolved value across multiple op runs.
_Avoid_: Global, shared instance

**Scoped binding**:
A lazy binding that resolves once per op run and caches the result for subsequent injects within that same run. The factory may return a value synchronously or asynchronously (`PromiseLike`).
_Avoid_: Request-scoped (unless the "request" is explicitly one op run), per-call

**Resolution**:
The act of turning a dependency inject into a concrete value by reading the run-scoped binding map. For scoped bindings, resolution invokes the factory on first inject (sync or async) and returns the cached value on later injects in the same run.
_Avoid_: Lookup (too generic), hydration

**Resolution gate (abort)**:
When the run signal is already aborted at the moment scoped resolution would invoke a factory, resolution fails immediately without calling the factory. The abort reason propagates through the runtime error channel.
_Avoid_: Pre-check (implementation detail), early exit

**Scoped cache (abort)**:
Once a scoped binding resolves successfully, its cached value remains for the rest of that op run even if the run signal aborts later. Abort stops forward progress but does not roll back factory side effects or invalidate the cache.
_Avoid_: Transactional resolution, undo

**Scoped factory**:
The per-run resolver passed to `DI.scoped`. Receives the run `AbortSignal` (same contract as `Op.try`), and may return a value or `PromiseLike`. DI applies the resolution gate and abort-aware await; the factory uses `signal` cooperatively for work it starts directly.
_Avoid_: Resolve callback (too generic), provider function
