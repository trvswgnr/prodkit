import { Op } from "@prodkit/op";
import { DI } from "@prodkit/op/di";
import { TaggedError } from "better-result";

/**
 * Runnable example for DI.scoped cancellation during resolution.
 *
 * Scoped bindings resolve once per op run. The factory receives the run AbortSignal
 * (same contract as Op.try). Abort before settlement leaves the binding uncached;
 * a later run resolves again. After a successful resolve, the cached value stays for
 * the rest of that run even if the signal aborts later.
 */

export type LedgerConnection = {
  readonly connId: string;
};

export type AccountSnapshot = {
  readonly accountId: string;
  readonly balanceCents: number;
  readonly connId: string;
};

export class LedgerConnectionService extends DI.Dependency(
  "LedgerConnectionService",
)<LedgerConnection> {}

export class BalanceFetchError extends TaggedError("BalanceFetchError")<{
  accountId: string;
  cause?: unknown;
}>() {}

export type LedgerDeps = {
  connectLedger: (signal: AbortSignal) => Promise<LedgerConnection>;
  fetchBalance: (conn: LedgerConnection, accountId: string, signal: AbortSignal) => Promise<number>;
};

export function createAccountSnapshotApp(deps: LedgerDeps) {
  const fetchBalance = Op(function* (conn: LedgerConnection, accountId: string) {
    return yield* Op.try(
      (signal) => deps.fetchBalance(conn, accountId, signal),
      (cause) => new BalanceFetchError({ accountId, cause }),
    );
  });

  const loadAccountSnapshot = Op(function* (accountId: string) {
    // Scoped DI memoizes within one run: the second inject reuses the first resolve.
    const conn = yield* DI.inject(LedgerConnectionService);
    const connAgain = yield* DI.inject(LedgerConnectionService);
    if (conn !== connAgain) {
      return yield* new BalanceFetchError({
        accountId,
        cause: new Error("scoped ledger connection was not memoized"),
      });
    }

    const balanceCents = yield* fetchBalance(conn, accountId);
    return { accountId, balanceCents, connId: conn.connId };
  });

  const runnable = DI.provide(
    loadAccountSnapshot,
    DI.scoped(LedgerConnectionService, (signal) => deps.connectLedger(signal)),
  );

  return { loadAccountSnapshot: runnable };
}
