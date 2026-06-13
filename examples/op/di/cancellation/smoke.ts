import { createAccountSnapshotApp } from "./sample.ts";
import { assert } from "../../../support/assert.ts";
import { Policy } from "@prodkit/op/policy";
import { UnhandledException } from "better-result";

export async function runCancellationExampleSmoke() {
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
    .with(Policy.cancel(midFactoryController.signal))
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
    .with(Policy.cancel(preAbortController.signal))
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
    .with(Policy.cancel(postCacheController.signal))
    .run("acct-post");
  postCacheController.abort(new Error("cancelled after cache"));
  const postCacheResult = await postCacheRun;
  assert(postCacheResult.isErr(), "di cancellation post-cache abort should fail");
  assert(
    postCacheFactoryCalls === 1,
    "di cancellation post-cache abort should keep resolved scoped binding cached",
  );
}
