import { ErrorGroup } from "@prodkit/op";
import {
  DuplicateEventError,
  FraudRiskTooHighError,
  InvalidWebhookError,
  ServiceCallError,
  createApp,
} from "./sample.ts";
import { assert } from "../../support/assert.ts";

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

export async function runWebhookExampleSmoke() {
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
