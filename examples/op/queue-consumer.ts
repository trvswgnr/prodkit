import { Op } from "@prodkit/op";
import { Delay } from "@prodkit/op/policy";
import { TaggedError } from "better-result";
import * as Policy from "@prodkit/op/policy";

export type QueueMessage = {
  id: string;
  payload: unknown;
};

export type ConsumerRunOptions = {
  pollIntervalMs: number;
  batchSize: number;
  maxIterations?: number;
};

export type ConsumerRunSummary = {
  batchesProcessed: number;
  messagesSucceeded: number;
  messagesFailed: number;
  stoppedReason: "max-iterations" | "shutdown";
};

export type ConsumerDeps = {
  pollBatch: (batchSize: number, signal: AbortSignal) => Promise<QueueMessage[]>;
  processMessage: (message: QueueMessage, signal: AbortSignal) => Promise<void>;
  ackMessage: (messageId: string, signal: AbortSignal) => Promise<void>;
  nackMessage: (messageId: string, signal: AbortSignal) => Promise<void>;
  onShutdown?: (signal: AbortSignal) => Promise<void>;
};

export const BATCH_CONCURRENCY = 2;

const retryTransient = {
  attempts: 3,
  when: (cause: unknown) => ServiceCallError.is(cause) && cause.retryable,
  delay: Delay.exponential({ baseMs: 25, maxMs: 200, jitter: 0 }),
};

function isRetryable(cause: unknown): boolean {
  return typeof cause === "object" &&
    cause !== null &&
    "retryable" in cause &&
    typeof cause.retryable === "boolean"
    ? cause.retryable
    : false;
}

export class ServiceCallError extends TaggedError("ServiceCallError")<{
  service: string;
  retryable: boolean;
  cause?: unknown;
}>() {
  static from(service: string, cause: unknown) {
    if (ServiceCallError.is(cause)) return cause;
    return new ServiceCallError({ service, retryable: isRetryable(cause), cause });
  }
}

export function createConsumerApp(deps: ConsumerDeps) {
  const pollBatch = Op(function* (batchSize: number) {
    return yield* Op.try(
      (signal) => deps.pollBatch(batchSize, signal),
      (cause) => ServiceCallError.from("queue", cause),
    ).with(Policy.retry(retryTransient));
  });

  const processMessage = Op(function* (message: QueueMessage) {
    yield* Op.try(
      (signal) => deps.processMessage(message, signal),
      (cause) => ServiceCallError.from("processor", cause),
    ).with(Policy.retry(retryTransient));
  });

  const ackMessage = Op(function* (messageId: string) {
    yield* Op.try(
      (signal) => deps.ackMessage(messageId, signal),
      (cause) => ServiceCallError.from("ack", cause),
    ).with(Policy.retry(retryTransient));
  });

  const nackMessage = Op(function* (messageId: string) {
    yield* Op.try(
      (signal) => deps.nackMessage(messageId, signal),
      (cause) => ServiceCallError.from("nack", cause),
    ).with(Policy.retry(retryTransient));
  });

  const handleMessage = Op(function* (message: QueueMessage) {
    const processed = yield* Op.settle(processMessage(message));
    if (processed.isOk()) {
      yield* ackMessage(message.id);
      return "ok" as const;
    }
    yield* nackMessage(message.id);
    return "failed" as const;
  });

  const processBatch = Op(function* (messages: QueueMessage[]) {
    if (messages.length === 0) return { succeeded: 0, failed: 0 };

    const results = yield* Op.allSettled(
      messages.map((message) => handleMessage(message)),
      BATCH_CONCURRENCY,
    );

    let succeeded = 0;
    let failed = 0;
    for (const result of results) {
      if (result.isErr()) {
        failed += 1;
        continue;
      }
      if (result.value === "ok") succeeded += 1;
      else failed += 1;
    }
    return { succeeded, failed };
  });

  const runConsumerLoop = Op(function* (opts: ConsumerRunOptions) {
    yield* Op.defer((ctx) => deps.onShutdown?.(ctx.signal) ?? Promise.resolve());

    let batchesProcessed = 0;
    let messagesSucceeded = 0;
    let messagesFailed = 0;

    for (
      let iteration = 0;
      opts.maxIterations === undefined || iteration < opts.maxIterations;
      iteration += 1
    ) {
      const batch = yield* pollBatch(opts.batchSize);
      if (batch.length > 0) {
        const batchSummary = yield* processBatch(batch);
        batchesProcessed += 1;
        messagesSucceeded += batchSummary.succeeded;
        messagesFailed += batchSummary.failed;
      }

      const waitResult = yield* Op.settle(Op.sleep(opts.pollIntervalMs));
      if (waitResult.isErr()) {
        return {
          batchesProcessed,
          messagesSucceeded,
          messagesFailed,
          stoppedReason: "shutdown" as const,
        };
      }
    }

    return {
      batchesProcessed,
      messagesSucceeded,
      messagesFailed,
      stoppedReason: "max-iterations" as const,
    };
  });

  return {
    pollBatch,
    processMessage,
    ackMessage,
    nackMessage,
    handleMessage,
    processBatch,
    runConsumerLoop,
  };
}
