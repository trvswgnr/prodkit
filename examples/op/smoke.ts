import { ErrorGroup, Op, TimeoutError } from "@prodkit/op";
import { TaggedError, UnhandledException } from "better-result";
import {
  DivisionByZeroError,
  FetchError,
  HttpError,
  NegativeError,
  ParseError,
  divide,
  fetchData,
  mathComposeProgram,
  parseUser,
  pollUntil,
  sqrt,
  userProgram,
  exampleWithPoll,
} from "./simple.ts";
import {
  DuplicateEventError,
  FraudRiskTooHighError,
  InvalidWebhookError,
  ServiceCallError,
  createApp,
} from "./webhook.ts";
import { ConnectionError, QueryFailedError, createDbApp } from "./defer-resource.ts";
import { createCatalogApp, CatalogFetchError } from "./signal-propagation.ts";
import {
  BATCH_CONCURRENCY,
  ServiceCallError as ConsumerServiceCallError,
  createConsumerApp,
} from "./queue-consumer.ts";
import { assert } from "../assert.ts";
import * as Policy from "@prodkit/op/policy";

function isNamedUser(value: unknown): value is { name: string } {
  return (
    typeof value === "object" && value !== null && "name" in value && typeof value.name === "string"
  );
}

class RetryableError extends Error {
  retryable = true;
}

function neverSettlesUntilAborted(signal: AbortSignal) {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(new RetryableError("aborted"));
    signal.addEventListener("abort", () => reject(new RetryableError("aborted")), { once: true });
  });
}

function createDeps(overrides = {}) {
  return {
    isDuplicateEvent: async () => false,
    reserveInventory: async () => ({ reservationId: "res-1", reserved: true }),
    authorizePayment: async () => ({ approved: true, authorizationId: "auth-1" }),
    riskPrimary: async () => 0.12,
    riskSecondary: async () => 0.11,
    loadFraudPolicyFromCache: async () => "policy-cache-v1",
    loadFraudPolicyFromConfig: async () => "policy-config-v1",
    persistOrder: async () => undefined,
    markEventProcessed: async () => undefined,
    sendReceipt: async () => undefined,
    publishAnalytics: async () => undefined,
    nowIso: () => "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const webhookPayload = {
  eventId: "evt-123",
  orderId: "ord-123",
  userId: "usr-123",
  currency: "USD",
  totalCents: 69_420,
  itemSkus: ["SKU-1", "SKU-2"],
};

async function runCoreApiSmoke() {
  class TooSmallError extends TaggedError("TooSmallError")<{ message: string }>() {}

  const localDivide = Op(function* (a: number, b: number) {
    if (b === 0) return yield* new TooSmallError({ message: "division by zero" });
    return a / b;
  });

  const localSqrt = Op(function* (n: number) {
    if (n < 0) return yield* new TooSmallError({ message: "negative input" });
    return Math.sqrt(n);
  });

  const compute = Op(function* () {
    const quotient = yield* localDivide(25, 5);
    const rooted = yield* localSqrt(quotient);
    return rooted;
  });

  const result = await compute
    .with(
      Policy.retry({
        attempts: 2,
        when: () => false,
        delay: () => 10,
      }),
    )
    .with(Policy.timeout(500))
    .run();

  assert(result.isOk() && result.value === Math.sqrt(5), "core smoke computation failed");

  const timeoutResult = await Op.try(
    (signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 50);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("aborted"));
        });
      }),
  )
    .with(Policy.timeout(1))
    .run();

  assert(
    timeoutResult.isErr() && timeoutResult.error instanceof TimeoutError,
    "timeout smoke failed",
  );

  const unexpectedResult = await Op.try(() => {
    throw "boom";
  }).run();

  assert(
    unexpectedResult.isErr() && unexpectedResult.error instanceof UnhandledException,
    "unexpected error smoke failed",
  );
}

async function runSimpleExampleSmoke() {
  const divideOk = await divide.run(10, 2);
  assert(divideOk.isOk() && divideOk.value === 5, "divide success check failed");

  const divideErr = await divide.run(10, 0);
  assert(
    divideErr.isErr() && divideErr.error instanceof DivisionByZeroError,
    "divide error check failed",
  );

  const sqrtOk = await sqrt.run(9);
  assert(sqrtOk.isOk() && sqrtOk.value === 3, "sqrt success check failed");

  const sqrtErr = await sqrt.run(-1);
  assert(sqrtErr.isErr() && sqrtErr.error instanceof NegativeError, "sqrt error check failed");
  if (sqrtErr.isErr() && sqrtErr.error instanceof NegativeError) {
    assert(sqrtErr.error.n === -1, "negative error payload check failed");
  }

  const composeResult = await mathComposeProgram.run();
  assert(
    composeResult.isErr() && composeResult.error instanceof NegativeError,
    "mathComposeProgram failure check failed",
  );

  const parseOk = await parseUser.run({ name: "Marissa" });
  assert(parseOk.isOk() && parseOk.value.name === "Marissa", "parseUser success check failed");

  const parseErr = await parseUser.run({ notName: 1 });
  assert(parseErr.isErr() && parseErr.error instanceof ParseError, "parseUser error check failed");

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ name: "Marissa" }), {
        status: 200,
        statusText: "OK",
      });
    const fetchOk = await fetchData.run("https://example.test/api/users/1");
    assert(
      fetchOk.isOk() && isNamedUser(fetchOk.value) && fetchOk.value.name === "Marissa",
      "fetchData success check failed",
    );

    globalThis.fetch = async () => new Response(null, { status: 404, statusText: "Not Found" });
    const fetchErr = await fetchData.run("https://example.test/missing");
    assert(
      fetchErr.isErr() && fetchErr.error instanceof FetchError,
      "fetchData error type check failed",
    );
    if (fetchErr.isErr()) {
      assert(fetchErr.error.cause instanceof HttpError, "fetchData cause type check failed");
    }

    globalThis.fetch = async (url) => {
      assert(String(url) === "/api/users/123", "userProgram URL check failed");
      return new Response(JSON.stringify({ name: "Marissa" }), {
        status: 200,
        statusText: "OK",
      });
    };
    const userOk = await userProgram.run("123");
    assert(
      userOk.isOk() && userOk.value.name === "Marissa",
      "userProgram composition check failed",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const pollResult = await exampleWithPoll.run();
  assert(pollResult.isOk(), "pollResult should be Ok");
  assert(pollResult.value.count === 10, `expected 10, got ${pollResult.value.count}`);

  const controller = new AbortController();
  const cancelledPollPromise = pollUntil(Op.of({ count: 0 }), {
    until: () => false,
    intervalMs: 50,
  })
    .with(Policy.signal(controller.signal))
    .run();
  controller.abort("poll cancelled");
  const cancelledPoll = await cancelledPollPromise;
  assert(cancelledPoll.isErr(), "cancelled poll should fail");
  assert(
    cancelledPoll.error instanceof UnhandledException,
    "cancelled poll should surface cancellation as UnhandledException",
  );
}

async function runDeferResourceExampleSmoke() {
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

function waitUntilAbort(signal: AbortSignal, onAbort?: () => void): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      onAbort?.();
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        onAbort?.();
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function runSignalPropagationExampleSmoke() {
  const happyPathApp = createCatalogApp({
    fetchMetadataFromCache: async (sku) => ({ sku, source: "cache" }),
    fetchMetadataFromOrigin: async (sku) => ({ sku, source: "origin" }),
    fetchPricing: async (sku) => ({ sku, cents: 1_299 }),
    fetchReviewSummary: async () => ({ averageRating: 4.5 }),
    fetchReviewHighlights: async () => ({ quotes: ["solid build quality"] }),
  });

  const pageOk = await happyPathApp.loadProductPage.run("sku-1");
  assert(pageOk.isOk(), "signal propagation happy path failed");
  if (pageOk.isOk()) {
    assert(pageOk.value.pricing.cents === 1_299, "signal propagation pricing check failed");
    assert(pageOk.value.reviews.length === 2, "signal propagation nested all check failed");
    assert(
      pageOk.value.reviews[0].averageRating === 4.5,
      "signal propagation review summary check failed",
    );
  }

  let cacheMetadataAborted = false;
  const raceApp = createCatalogApp({
    fetchMetadataFromCache: async (sku, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ sku, source: "cache" }), 50);
        signal.addEventListener(
          "abort",
          () => {
            cacheMetadataAborted = true;
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
          },
          { once: true },
        );
      }),
    fetchMetadataFromOrigin: async (sku) => ({ sku, source: "origin" }),
    fetchPricing: async (sku) => ({ sku, cents: 999 }),
    fetchReviewSummary: async () => ({ averageRating: 4.1 }),
    fetchReviewHighlights: async () => ({ quotes: ["fast shipping"] }),
  });

  const raceResult = await raceApp.loadProductPage.run("sku-1");
  assert(raceResult.isOk(), "signal propagation race path failed");
  if (raceResult.isOk()) {
    assert(
      raceResult.value.metadata.source === "origin",
      "signal propagation race winner check failed",
    );
  }
  assert(cacheMetadataAborted, "signal propagation race loser abort check failed");

  const abortedBranches: string[] = [];
  let pricingStarted = false;
  const cancelApp = createCatalogApp({
    fetchMetadataFromCache: async (sku) => ({ sku, source: "cache" }),
    fetchMetadataFromOrigin: async (sku) => ({ sku, source: "origin" }),
    fetchPricing: async (_sku, signal) => {
      pricingStarted = true;
      await waitUntilAbort(signal, () => abortedBranches.push("pricing"));
      throw new Error("unreachable");
    },
    fetchReviewSummary: async (_sku, signal) => {
      await waitUntilAbort(signal, () => abortedBranches.push("review-summary"));
      throw new Error("unreachable");
    },
    fetchReviewHighlights: async (_sku, signal) => {
      await waitUntilAbort(signal, () => abortedBranches.push("review-highlights"));
      throw new Error("unreachable");
    },
  });

  const controller = new AbortController();
  const cancelledRun = cancelApp.loadProductPage
    .with(Policy.signal(controller.signal))
    .run("sku-1");
  // oxlint-disable-next-line no-unmodified-loop-condition
  for (let attempt = 0; attempt < 20 && !pricingStarted; attempt += 1) {
    await Promise.resolve();
  }
  assert(pricingStarted, "signal propagation cancel setup failed to start nested all work");
  controller.abort(new Error("navigation cancelled"));

  const cancelled = await cancelledRun;
  assert(cancelled.isErr(), "signal propagation external cancel should fail");
  assert(
    cancelled.error instanceof CatalogFetchError,
    "signal propagation external cancel error type check failed",
  );
  assert(
    abortedBranches.includes("pricing"),
    "signal propagation external cancel pricing abort check failed",
  );
  assert(
    abortedBranches.includes("review-summary"),
    "signal propagation external cancel review-summary abort check failed",
  );
  assert(
    abortedBranches.includes("review-highlights"),
    "signal propagation external cancel review-highlights abort check failed",
  );
}

async function runWebhookExampleSmoke() {
  let analyticsPublished = false;
  const appWithWarning = createApp(
    createDeps({
      sendReceipt: async () => {
        throw new Error("smtp unavailable");
      },
      publishAnalytics: async () => {
        analyticsPublished = true;
      },
    }),
  );
  const happyPath = await appWithWarning.processOrderWebhook.run(webhookPayload);
  assert(happyPath.isOk(), "webhook happy path check failed");
  if (happyPath.isOk()) {
    assert(happyPath.value.orderId === "ord-123", "happy path order id check failed");
    assert(happyPath.value.authorizationId === "auth-1", "happy path authorization check failed");
    assert(happyPath.value.warnings.length === 1, "happy path warnings check failed");
  }
  assert(analyticsPublished, "bounded allSettled drain check failed");

  const duplicateApp = createApp(createDeps({ isDuplicateEvent: async () => true }));
  const duplicate = await duplicateApp.processOrderWebhook.run(webhookPayload);
  assert(
    duplicate.isErr() && duplicate.error instanceof DuplicateEventError,
    "duplicate event check failed",
  );

  const invalidNegativeCents = await appWithWarning.processOrderWebhook.run({
    ...webhookPayload,
    totalCents: -1,
  });
  assert(
    invalidNegativeCents.isErr() && invalidNegativeCents.error instanceof InvalidWebhookError,
    "negative totalCents validation check failed",
  );
  if (invalidNegativeCents.isErr() && invalidNegativeCents.error instanceof InvalidWebhookError) {
    assert(
      invalidNegativeCents.error.issues.some((issue) =>
        issue.path?.some((segment) => segment.key === "totalCents"),
      ),
      "negative totalCents issue details check failed",
    );
  }

  const invalidNaNCents = await appWithWarning.processOrderWebhook.run({
    ...webhookPayload,
    totalCents: Number.NaN,
  });
  assert(
    invalidNaNCents.isErr() && invalidNaNCents.error instanceof InvalidWebhookError,
    "NaN totalCents validation check failed",
  );
  if (invalidNaNCents.isErr() && invalidNaNCents.error instanceof InvalidWebhookError) {
    assert(
      invalidNaNCents.error.issues.some((issue) =>
        issue.path?.some((segment) => segment.key === "totalCents"),
      ),
      "NaN totalCents issue details check failed",
    );
  }

  let paymentAttempts = 0;
  const retryPaymentApp = createApp(
    createDeps({
      authorizePayment: async () => {
        paymentAttempts += 1;
        if (paymentAttempts === 1) throw new RetryableError("payment timeout");
        return { approved: true, authorizationId: "auth-retried" };
      },
    }),
  );
  const retryPayment = await retryPaymentApp.processOrderWebhook.run(webhookPayload);
  assert(retryPayment.isOk(), "retry payment check failed");
  assert(paymentAttempts === 2, "retry payment attempts check failed");

  const fallbackRiskApp = createApp(
    createDeps({
      riskPrimary: async () => {
        throw new RetryableError("primary unavailable");
      },
      riskSecondary: async () => 0.2,
    }),
  );
  const fallbackRisk = await fallbackRiskApp.processOrderWebhook.run(webhookPayload);
  assert(fallbackRisk.isOk() && fallbackRisk.value.riskScore === 0.2, "risk fallback check failed");

  const allRiskFailApp = createApp(
    createDeps({
      riskPrimary: async () => {
        throw new RetryableError("primary unavailable");
      },
      riskSecondary: async () => {
        throw new RetryableError("secondary unavailable");
      },
    }),
  );
  const allRiskFail = await allRiskFailApp.processOrderWebhook.run(webhookPayload);
  assert(
    allRiskFail.isErr() && allRiskFail.error instanceof ErrorGroup,
    "all-risk-fail check failed",
  );

  const fraudApp = createApp(createDeps({ riskPrimary: async () => 0.97 }));
  const fraudResult = await fraudApp.processOrderWebhook.run(webhookPayload);
  assert(
    fraudResult.isErr() && fraudResult.error instanceof FraudRiskTooHighError,
    "fraud gate check failed",
  );

  let inventoryAborted = false;
  const abortedInventoryApp = createApp(
    createDeps({
      reserveInventory: async (_: unknown, signal: AbortSignal) => {
        try {
          await neverSettlesUntilAborted(signal);
          throw new Error("unreachable");
        } catch {
          inventoryAborted = signal.aborted;
          throw new RetryableError("inventory aborted");
        }
      },
      authorizePayment: async () => {
        throw new Error("payment terminal failure");
      },
    }),
  );
  const abortedInventoryResult = await abortedInventoryApp.processOrderWebhook.run(webhookPayload);
  assert(
    abortedInventoryResult.isErr() && abortedInventoryResult.error instanceof ServiceCallError,
    "inventory abort error type check failed",
  );
  assert(inventoryAborted, "inventory abort propagation check failed");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runQueueConsumerExampleSmoke() {
  const messages = [
    { id: "m1", payload: { n: 1 } },
    { id: "m2", payload: { n: 2 } },
    { id: "m3", payload: { n: 3 } },
    { id: "m4", payload: { n: 4 } },
    { id: "m5", payload: { n: 5 } },
    { id: "m6", payload: { n: 6 } },
  ];

  let pollCalls = 0;
  const processAttempts = new Map<string, number>();
  let inFlight = 0;
  let maxInFlight = 0;
  const acked: string[] = [];
  const nacked: string[] = [];

  const app = createConsumerApp({
    pollBatch: async (batchSize) => {
      pollCalls += 1;
      if (pollCalls === 1) return messages.slice(0, batchSize);
      if (pollCalls === 2) return messages.slice(3, 6);
      return [];
    },
    processMessage: async (message) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight -= 1;

      const attempts = (processAttempts.get(message.id) ?? 0) + 1;
      processAttempts.set(message.id, attempts);
      if (message.id === "m2" && attempts === 1) {
        throw Object.assign(new Error("processor timeout"), { retryable: true });
      }
      if (message.id === "m5") {
        throw new Error("terminal processor failure");
      }
    },
    ackMessage: async (messageId) => {
      acked.push(messageId);
    },
    nackMessage: async (messageId) => {
      nacked.push(messageId);
    },
  });

  const summaryResult = await app.runConsumerLoop.run({
    pollIntervalMs: 5,
    batchSize: 3,
    maxIterations: 3,
  });
  assert(summaryResult.isOk(), "queue consumer happy path check failed");
  if (!summaryResult.isOk()) return;
  const summary = summaryResult.value;

  assert(summary.batchesProcessed === 2, "queue consumer batch count check failed");
  assert(summary.messagesSucceeded === 5, "queue consumer success count check failed");
  assert(summary.messagesFailed === 1, "queue consumer failure count check failed");
  assert(summary.stoppedReason === "max-iterations", "queue consumer stop reason check failed");
  assert(processAttempts.get("m2") === 2, "queue consumer retry check failed");
  assert(maxInFlight <= BATCH_CONCURRENCY, "queue consumer concurrency cap check failed");
  assert(acked.includes("m1") && acked.includes("m2"), "queue consumer ack check failed");
  assert(nacked.includes("m5"), "queue consumer nack check failed");

  pollCalls = 0;
  let shutdownCalled = false;
  let secondPollStarted = false;
  const shutdownApp = createConsumerApp({
    pollBatch: async () => {
      pollCalls += 1;
      if (pollCalls === 1) return [{ id: "s1", payload: { ready: true } }];
      secondPollStarted = true;
      return [{ id: "s2", payload: { ready: true } }];
    },
    processMessage: async () => {
      await delay(10);
    },
    ackMessage: async () => undefined,
    nackMessage: async () => undefined,
    onShutdown: async () => {
      shutdownCalled = true;
    },
  });

  const controller = new AbortController();
  const shutdownRun = shutdownApp.runConsumerLoop
    .with(Policy.signal(controller.signal))
    .run({ pollIntervalMs: 100, batchSize: 5 });
  await delay(30);
  controller.abort("shutdown requested");
  const shutdownResult = await shutdownRun;
  assert(shutdownResult.isOk(), "queue consumer graceful shutdown result check failed");
  if (!shutdownResult.isOk()) return;
  const shutdownSummary = shutdownResult.value;

  assert(
    shutdownSummary.stoppedReason === "shutdown",
    "queue consumer graceful shutdown check failed",
  );
  assert(
    shutdownSummary.messagesSucceeded === 1,
    "queue consumer shutdown batch completion check failed",
  );
  assert(shutdownCalled, "queue consumer shutdown cleanup check failed");
  assert(!secondPollStarted, "queue consumer shutdown should stop before next poll");

  let pollAborted = false;
  const abortDuringPollApp = createConsumerApp({
    pollBatch: async (_batchSize, signal) => {
      await waitUntilAbort(signal, () => {
        pollAborted = true;
      });
      throw new Error("unreachable");
    },
    processMessage: async () => undefined,
    ackMessage: async () => undefined,
    nackMessage: async () => undefined,
  });

  const pollController = new AbortController();
  const pollAbortRun = abortDuringPollApp.runConsumerLoop
    .with(Policy.signal(pollController.signal))
    .run({ pollIntervalMs: 100, batchSize: 1, maxIterations: 2 });
  await delay(10);
  pollController.abort(new ConsumerServiceCallError({ service: "queue", retryable: false }));
  const pollAbortResult = await pollAbortRun;

  assert(
    pollAbortResult.isErr() && pollAbortResult.error instanceof ConsumerServiceCallError,
    "queue consumer poll abort error type check failed",
  );
  assert(pollAborted, "queue consumer poll abort propagation check failed");
}

export async function runOpExamplesSmoke() {
  await runCoreApiSmoke();
  await runSimpleExampleSmoke();
  await runDeferResourceExampleSmoke();
  await runSignalPropagationExampleSmoke();
  await runWebhookExampleSmoke();
  await runQueueConsumerExampleSmoke();
}
