# Cooperative cancellation

Cancellation is cooperative, not preemptive. `@prodkit/op` raises abort signals at the right
points; operation code must observe those signals for work to stop quickly.

## Runtime guarantees

- `.with(Policy.timeout(...))`, `.with(Policy.cancel(...))`, and short-circuiting combinators
  (`Op.all`, `Op.any`, `Op.race`) propagate abort through `AbortSignal`.
- `Op.sleep(ms)` observes abort signals and stops waiting early when its enclosing run is cancelled.
- When a combinator decides its final result early, in-flight siblings are aborted and the
  combinator waits for them to settle before returning.
- Scheduled teardown still runs (`Op.defer`, `.with(Policy.release(...))`, `.on("exit", ...)`) even
  when a run ends via timeout or external abort.

## Caller responsibilities

- Build side-effecting work with `Op.try((signal) => ...)` and pass `signal` to cancellable APIs
  (`fetch`, DB clients, queue clients, etc.).
- Keep composed child ops signal-aware so branch-level cancellation in combinators can stop
  downstream IO.
- Treat cancellation as a stop request: if an underlying dependency ignores `AbortSignal`, that
  dependency can continue running after the op settles.

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
