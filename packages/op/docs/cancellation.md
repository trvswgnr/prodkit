# Cancellation

Cancellation gives dependencies a cooperative stop signal and gives an `Op` run an interrupting
suspension boundary. Operation code should still observe `AbortSignal` so underlying work stops
quickly instead of continuing after the operation has unwound.

## Runtime guarantees

- `.with(Policy.timeout(...))`, `.with(Policy.cancel(...))`, and short-circuiting combinators
  (`Op.all`, `Op.any`, `Op.race`) propagate abort through `AbortSignal`.
- A signal already aborted when `.run()` starts prevents the operation wrapped by `Policy.cancel`
  from starting. The result is `Err(UnhandledException)` with the abort reason as `cause`.
- After work starts, cancellation first allows in-flight work to settle cooperatively and preserves
  that `Result`, including mapped typed errors. Work that does not cooperate is interrupted at its
  current suspension boundary.
- `Op.sleep(ms)` observes abort signals and stops waiting early when its enclosing run is cancelled.
- When a combinator decides its final result early, in-flight siblings are aborted and the
  combinator waits for them to settle before returning.
- Scheduled teardown still runs (`Op.defer`, `.with(Policy.release(...))`, `.on("exit", ...)`) even
  when a run ends via timeout or external abort. `.run()` waits for asynchronous teardown.
- `Policy.release` remains success-gated: cancellation runs an already-registered release hook but
  does not register one when the wrapped operation never succeeds.

## Caller responsibilities

- Build side-effecting work with `Op.try((signal) => ...)` and pass `signal` to cancellable APIs
  (`fetch`, DB clients, queue clients, etc.).
- Keep composed child ops signal-aware so branch-level cancellation in combinators can stop
  downstream IO.
- Treat cancellation as a stop request for dependencies: if underlying work ignores `AbortSignal`,
  it can continue running after the `Op` has interrupted its suspension boundary and settled.

## Composed-run wiring

```ts
import { Policy } from "@prodkit/op/policy";

const controller = new AbortController();

const fetchJson = (url: string) =>
  Op.try(async (signal) => {
    const res = await fetch(url, { signal });
    return res.json();
  });

const loadDashboard = Op.all([
  fetchJson("/api/users/1"),
  fetchJson("/api/alerts"),
  fetchJson("/api/settings"),
])
  .with(Policy.timeout(1_500))
  .with(Policy.cancel(controller.signal));

const runPromise = loadDashboard.run();
controller.abort(new Error("caller aborted dashboard load"));
const result = await runPromise;
```

When a combinator decides early (`Op.all`, `Op.any`, `Op.race`), aborted siblings are interrupted at
suspend boundaries and the combinator waits for their teardown to finish before `.run()` resolves.
`Op.allSettled` does not short-circuit on failure and relies on cooperative cancel only.

When bound cancellation interrupts a body and cleanup also fails, `.run()` returns
`Err(UnhandledException)` with an `ErrorGroup` cause. The raw abort reason is first, followed by
exact cleanup faults in LIFO execution order. If cooperative work maps cancellation to a typed
error, that typed error remains first instead.
