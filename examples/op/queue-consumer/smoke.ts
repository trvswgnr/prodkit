import {
  BATCH_CONCURRENCY,
  ServiceCallError as ConsumerServiceCallError,
  createConsumerApp,
} from "./sample.ts";
import { assert } from "../../support/assert.ts";
import { Policy } from "@prodkit/op/policy";
import { waitUntilAbort } from "../../support/helpers.ts";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runQueueConsumerExampleSmoke() {
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
    .with(Policy.cancel(controller.signal))
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
    .with(Policy.cancel(pollController.signal))
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
