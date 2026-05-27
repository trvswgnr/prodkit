import { Op } from "@prodkit/op";
import { TaggedError } from "better-result";

export type AuditSession = { sessionId: string };
export type DbConnection = { connId: string };
export type DbRow = { sql: string };

export type DbDeps = {
  beginAuditSession: (userId: string, signal: AbortSignal) => Promise<AuditSession>;
  endAuditSession: (session: AuditSession, signal: AbortSignal) => Promise<void>;
  checkoutConnection: (signal: AbortSignal) => Promise<DbConnection>;
  releaseConnection: (conn: DbConnection) => Promise<void>;
  query: (conn: DbConnection, sql: string, signal: AbortSignal) => Promise<DbRow[]>;
};

export class ConnectionError extends TaggedError("ConnectionError")<{ cause?: unknown }>() {}
export class QueryFailedError extends TaggedError("QueryFailedError")<{
  sql: string;
  cause?: unknown;
}>() {}

export function createDbApp(deps: DbDeps) {
  const beginAuditSession = Op(function* (userId: string) {
    return yield* Op.try((signal) => deps.beginAuditSession(userId, signal));
  });

  const acquireConnection = Op(function* () {
    return yield* Op.try(
      (signal) => deps.checkoutConnection(signal),
      (cause) => new ConnectionError({ cause }),
    );
  });

  const executeQuery = Op(function* (conn: DbConnection, sql: string) {
    return yield* Op.try(
      (signal) => deps.query(conn, sql, signal),
      (cause) => new QueryFailedError({ sql, cause }),
    );
  });

  const loadUserDashboard = Op(function* (userId: string) {
    const auditSession = yield* beginAuditSession(userId);
    // Op.defer: the audit scope must end on every exit after it starts, including checkout failure
    yield* Op.defer((ctx) => deps.endAuditSession(auditSession, ctx.signal));

    // withRelease: only connections that checkout actually returned get released
    const conn = yield* acquireConnection.withRelease((connection) =>
      deps.releaseConnection(connection),
    );

    const user = yield* executeQuery(conn, `SELECT * FROM users WHERE id = '${userId}'`);
    const orders = yield* executeQuery(conn, `SELECT * FROM orders WHERE user_id = '${userId}'`);
    return { user, orders };
  });

  return { loadUserDashboard };
}
