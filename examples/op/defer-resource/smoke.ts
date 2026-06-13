import { ConnectionError, QueryFailedError, createDbApp } from "./sample.ts";
import { assert } from "../../support/assert.ts";

export async function runDeferResourceExampleSmoke() {
  let auditEnded = false;
  let connectionReleased = false;
  const successApp = createDbApp({
    beginAuditSession: async (userId) => ({ sessionId: `audit-${userId}` }),
    endAuditSession: async () => {
      auditEnded = true;
    },
    checkoutConnection: async () => ({ connId: "conn-1" }),
    releaseConnection: async () => {
      connectionReleased = true;
    },
    query: async (_conn, sql) => [{ sql }],
  });

  const dashboardOk = await successApp.loadUserDashboard.run("user-123");
  assert(dashboardOk.isOk(), "defer resource dashboard success path failed");
  if (dashboardOk.isOk()) {
    assert(dashboardOk.value.user.length === 1, "defer resource user rows check failed");
    assert(dashboardOk.value.orders.length === 1, "defer resource order rows check failed");
  }
  assert(auditEnded, "defer resource success audit cleanup check failed");
  assert(connectionReleased, "defer resource success connection release check failed");

  auditEnded = false;
  connectionReleased = false;
  let queryCalls = 0;
  const queryFailureApp = createDbApp({
    beginAuditSession: async (userId) => ({ sessionId: `audit-${userId}` }),
    endAuditSession: async () => {
      auditEnded = true;
    },
    checkoutConnection: async () => ({ connId: "conn-2" }),
    releaseConnection: async () => {
      connectionReleased = true;
    },
    query: async (_conn, sql) => {
      queryCalls += 1;
      if (queryCalls === 2) {
        throw new Error("orders table unavailable");
      }
      return [{ sql }];
    },
  });

  const dashboardErr = await queryFailureApp.loadUserDashboard.run("user-123");
  assert(
    dashboardErr.isErr() && dashboardErr.error instanceof QueryFailedError,
    "defer resource query failure path error check failed",
  );
  assert(queryCalls === 2, "defer resource query failure should fail on second query");
  assert(auditEnded, "defer resource query failure audit cleanup check failed");
  assert(connectionReleased, "defer resource query failure connection release check failed");

  auditEnded = false;
  let releaseCalls = 0;
  const checkoutFailureApp = createDbApp({
    beginAuditSession: async (userId) => ({ sessionId: `audit-${userId}` }),
    endAuditSession: async () => {
      auditEnded = true;
    },
    checkoutConnection: async () => {
      throw new ConnectionError({});
    },
    releaseConnection: async () => {
      releaseCalls += 1;
    },
    query: async (_conn, sql) => [{ sql }],
  });

  const checkoutErr = await checkoutFailureApp.loadUserDashboard.run("user-123");
  assert(
    checkoutErr.isErr() && checkoutErr.error instanceof ConnectionError,
    "defer resource checkout failure error check failed",
  );
  assert(auditEnded, "defer resource checkout failure audit cleanup check failed");
  assert(releaseCalls === 0, "defer resource checkout failure should not release connection");
}
