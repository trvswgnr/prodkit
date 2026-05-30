import {
  DuplicateEmailError,
  createExampleDependencies,
  registerUser,
  runnableRegisterUser,
} from "./onboarding.ts";
import { createAccountSnapshotApp } from "./di-cancellation.ts";
import {
  InvalidRequestError,
  PoolCheckoutError,
  UserLookupError,
  UserNotFoundError,
  runnableHandleGetUser,
} from "./http-handler.ts";
import { assert } from "../../assert.ts";
import { Op } from "@prodkit/op";
import { DI } from "@prodkit/op/di";
import { UnhandledException } from "better-result";

async function runSuccessfulRegistrationSmoke() {
  const { op, services } = runnableRegisterUser();

  const result = await op.run("marissa@example.test", "correct horse battery staple");

  assert(result.isOk(), "registration should succeed");
  assert(result.value.email === "marissa@example.test", "registered user email should match");
  assert(result.value.createdAt === "2026-05-15T12:00:00.000Z", "createdAt should come from clock");
  assert(services.db.value.records.length === 1, "database should contain the registered user");
  assert(
    services.sentWelcomeEmails.join(",") === "marissa@example.test",
    "mailer should send one welcome email",
  );
}

async function runDuplicateRegistrationSmoke() {
  const services = createExampleDependencies();
  const op = DI.provide(
    registerUser,
    services.db,
    services.hasher,
    services.mailer,
    services.clock,
  );

  const first = await op.run("existing@example.test", "first");
  assert(first.isOk(), "first registration should succeed");

  const duplicate = await op.run("existing@example.test", "second");
  assert(
    duplicate.isErr() && duplicate.error instanceof DuplicateEmailError,
    "duplicate registration should fail with DuplicateEmailError",
  );
  assert(services.db.value.records.length === 1, "duplicate registration should not insert a user");
  assert(
    services.sentWelcomeEmails.join(",") === "existing@example.test",
    "duplicate registration should not send another welcome email",
  );
}

async function runDiCancellationExampleSmoke() {
  let connectCalls = 0;
  const happyPathApp = createAccountSnapshotApp({
    connectLedger: async (signal) => {
      connectCalls += 1;
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
      return { connId: `ledger-${connectCalls}` };
    },
    fetchBalance: async (_conn, _accountId) => 12_500,
  });

  const snapshotOk = await happyPathApp.loadAccountSnapshot.run("acct-1");
  assert(snapshotOk.isOk(), "di cancellation happy path failed");
  if (snapshotOk.isOk()) {
    assert(snapshotOk.value.balanceCents === 12_500, "di cancellation balance check failed");
    assert(snapshotOk.value.connId === "ledger-1", "di cancellation connection id check failed");
  }
  assert(connectCalls === 1, "di cancellation happy path should connect once per run");

  connectCalls = 0;
  const secondRun = await happyPathApp.loadAccountSnapshot.run("acct-2");
  assert(secondRun.isOk(), "di cancellation second run failed");
  assert(connectCalls === 1, "di cancellation should resolve scoped binding again on a new run");

  let midFactoryCalls = 0;
  const midFactoryApp = createAccountSnapshotApp({
    connectLedger: async (signal) => {
      midFactoryCalls += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ connId: "ledger-mid" }), 50);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
          },
          { once: true },
        );
      });
    },
    fetchBalance: async () => 0,
  });

  const midFactoryController = new AbortController();
  const midFactoryRun = midFactoryApp.loadAccountSnapshot
    .withSignal(midFactoryController.signal)
    .run("acct-mid");
  midFactoryController.abort(new Error("cancelled mid-factory"));
  const midFactoryResult = await midFactoryRun;
  assert(midFactoryResult.isErr(), "di cancellation mid-factory abort should fail");
  assert(
    midFactoryResult.isErr() &&
      midFactoryResult.error instanceof UnhandledException &&
      midFactoryResult.error.cause instanceof Error &&
      midFactoryResult.error.cause.message === "cancelled mid-factory",
    "di cancellation mid-factory abort reason check failed",
  );
  assert(midFactoryCalls === 1, "di cancellation mid-factory abort should invoke factory once");

  midFactoryCalls = 0;
  const recovered = await midFactoryApp.loadAccountSnapshot.run("acct-mid");
  assert(recovered.isOk(), "di cancellation retry after mid-factory abort failed");
  assert(midFactoryCalls === 1, "di cancellation retry should resolve uncached binding again");

  let preAbortCalls = 0;
  const preAbortController = new AbortController();
  preAbortController.abort(new Error("already cancelled"));
  const preAbortApp = createAccountSnapshotApp({
    connectLedger: async () => {
      preAbortCalls += 1;
      return { connId: "ledger-pre" };
    },
    fetchBalance: async () => 0,
  });

  const preAbortResult = await preAbortApp.loadAccountSnapshot
    .withSignal(preAbortController.signal)
    .run("acct-pre");
  assert(preAbortResult.isErr(), "di cancellation pre-abort should fail");
  assert(preAbortCalls === 0, "di cancellation pre-abort should skip scoped factory");
  assert(
    preAbortResult.isErr() &&
      preAbortResult.error instanceof UnhandledException &&
      preAbortResult.error.cause instanceof Error &&
      preAbortResult.error.cause.message === "already cancelled",
    "di cancellation pre-abort reason check failed",
  );

  let postCacheFactoryCalls = 0;
  const postCacheController = new AbortController();
  const postCacheApp = createAccountSnapshotApp({
    connectLedger: async (signal) => {
      postCacheFactoryCalls += 1;
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
      return { connId: "ledger-post" };
    },
    fetchBalance: async (_conn, _accountId, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(42), 100);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
          },
          { once: true },
        );
      }),
  });

  const postCacheRun = postCacheApp.loadAccountSnapshot
    .withSignal(postCacheController.signal)
    .run("acct-post");
  postCacheController.abort(new Error("cancelled after cache"));
  const postCacheResult = await postCacheRun;
  assert(postCacheResult.isErr(), "di cancellation post-cache abort should fail");
  assert(
    postCacheFactoryCalls === 1,
    "di cancellation post-cache abort should keep resolved scoped binding cached",
  );
}

async function runHttpHandlerExampleSmoke() {
  let releasedConnId: string | undefined;
  const success = runnableHandleGetUser(
    {
      checkout: async () => ({ connId: "pool-1" }),
      release: async (conn) => {
        releasedConnId = conn.connId;
      },
    },
    {
      findById: Op(function* (_conn, userId) {
        return { userId, displayName: `User ${userId}` };
      }),
    },
  );

  const okResult = await success.op.run({
    method: "GET",
    path: "/users/user-123",
    body: null,
  });
  assert(okResult.isOk(), "http handler success path check failed");
  if (okResult.isOk()) {
    assert(okResult.value.status === 200, "http handler success status check failed");
    assert(
      okResult.value.body.userId === "user-123",
      "http handler success body user id check failed",
    );
  }
  assert(releasedConnId === "pool-1", "http handler success pool release check failed");

  releasedConnId = undefined;
  let lookupCalls = 0;
  const lookupFailure = runnableHandleGetUser(
    {
      checkout: async () => ({ connId: "pool-2" }),
      release: async (conn) => {
        releasedConnId = conn.connId;
      },
    },
    {
      findById: Op(function* (_conn, userId) {
        lookupCalls += 1;
        return yield* new UserLookupError({ userId, cause: new Error("database read failed") });
      }),
    },
  );

  const lookupErr = await lookupFailure.op.run({
    method: "GET",
    path: "/users/user-456",
    body: null,
  });
  assert(
    lookupErr.isErr() && lookupErr.error instanceof UserLookupError,
    "http handler lookup failure error check failed",
  );
  assert(lookupCalls === 1, "http handler lookup failure should attempt one read");
  assert(releasedConnId === "pool-2", "http handler lookup failure pool release check failed");

  let checkoutCalls = 0;
  let releaseCalls = 0;
  const invalidRequest = runnableHandleGetUser(
    {
      checkout: async () => {
        checkoutCalls += 1;
        return { connId: "pool-unused" };
      },
      release: async () => {
        releaseCalls += 1;
      },
    },
    {
      findById: Op(function* (_conn, _userId) {
        return { userId: "unused", displayName: "unused" };
      }),
    },
  );

  const invalidResult = await invalidRequest.op.run({
    method: "POST",
    path: "/users/user-789",
    body: null,
  });
  assert(
    invalidResult.isErr() && invalidResult.error instanceof InvalidRequestError,
    "http handler invalid request error check failed",
  );
  assert(checkoutCalls === 0, "http handler invalid request should not checkout");
  assert(releaseCalls === 0, "http handler invalid request should not release");

  checkoutCalls = 0;
  releaseCalls = 0;
  const checkoutFailure = runnableHandleGetUser(
    {
      checkout: async () => {
        checkoutCalls += 1;
        throw new PoolCheckoutError({});
      },
      release: async () => {
        releaseCalls += 1;
      },
    },
    {
      findById: Op(function* (_conn, _userId) {
        return { userId: "unused", displayName: "unused" };
      }),
    },
  );

  const checkoutErr = await checkoutFailure.op.run({
    method: "GET",
    path: "/users/user-000",
    body: null,
  });
  assert(
    checkoutErr.isErr() &&
      checkoutErr.error instanceof UnhandledException &&
      checkoutErr.error.cause instanceof PoolCheckoutError,
    "http handler checkout failure error check failed",
  );
  assert(checkoutCalls === 1, "http handler checkout failure should attempt checkout");
  assert(releaseCalls === 0, "http handler checkout failure should not release");

  releasedConnId = undefined;
  const notFound = runnableHandleGetUser(
    {
      checkout: async () => ({ connId: "pool-3" }),
      release: async (conn) => {
        releasedConnId = conn.connId;
      },
    },
    {
      findById: Op(function* (_conn, _userId) {
        return null;
      }),
    },
  );

  const notFoundResult = await notFound.op.run({
    method: "GET",
    path: "/users/missing-user",
    body: null,
  });
  assert(
    notFoundResult.isErr() && notFoundResult.error instanceof UserNotFoundError,
    "http handler not found error check failed",
  );
  assert(releasedConnId === "pool-3", "http handler not found pool release check failed");
}

export async function runDiExamplesSmoke() {
  await runSuccessfulRegistrationSmoke();
  await runDuplicateRegistrationSmoke();
  await runDiCancellationExampleSmoke();
  await runHttpHandlerExampleSmoke();
}
