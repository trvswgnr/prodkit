import { bench, describe } from "vitest";
import { Op } from "@prodkit/op";
import { assertProfileOpFactory } from "./harness.ts";
import {
  runAsyncChain,
  runAsyncFnChain,
  runOpFlatLoop,
  runOpSequentialRuns,
  runOpYieldChain,
  runRawSyncYieldStarChain,
} from "./scenarios.ts";

const op = assertProfileOpFactory(Op);

const CONCURRENCY_CHILDREN = 8;
const RETRY_ATTEMPTS = 3;
const TIMEOUT_BUDGET_MS = 250;

async function handRolledFirstSettler(childCount: number): Promise<void> {
  let winner: number | undefined;
  const controllers = Array.from({ length: childCount }, () => new AbortController());
  await Promise.all(
    Array.from({ length: childCount }, (_, index) =>
      Promise.resolve(index).then((value) => {
        if (winner === undefined) {
          winner = value;
          controllers.forEach((controller, controllerIndex) => {
            if (controllerIndex !== index) controller.abort();
          });
        }
        return value;
      }),
    ),
  );
  if (winner === undefined) {
    throw new Error("handRolledFirstSettler exhausted unexpectedly.");
  }
}

describe("singleOp", () => {
  bench("singleOp.rawAsync", async () => {
    await Promise.resolve(69);
  });

  bench("singleOp.opRun", async () => {
    const result = await Op.of(69).run();
    if (!result.isOk()) throw new Error("singleOp.opRun failed unexpectedly.");
  });
});

describe("all", () => {
  bench("all.promiseAll", async () => {
    await Promise.all(
      Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Promise.resolve(index)),
    );
  });

  bench("all.opAll", async () => {
    const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
    const result = await Op.all(ops).run();
    if (!result.isOk()) throw new Error("all.opAll failed unexpectedly.");
  });
});

describe("any", () => {
  bench("any.handRolledFirstSuccess", async () => {
    await handRolledFirstSettler(CONCURRENCY_CHILDREN);
  });

  bench("any.opAny", async () => {
    const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
    const result = await Op.any(ops).run();
    if (!result.isOk()) throw new Error("any.opAny failed unexpectedly.");
  });
});

describe("race", () => {
  bench("race.handRolledFirstSettler", async () => {
    await handRolledFirstSettler(CONCURRENCY_CHILDREN);
  });

  bench("race.opRace", async () => {
    const ops = Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Op.of(index));
    const result = await Op.race(ops).run();
    if (!result.isOk()) throw new Error("race.opRace failed unexpectedly.");
  });
});

describe("retry", () => {
  bench("retry.handRolled", async () => {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        if (attempt < RETRY_ATTEMPTS) throw new Error("retry");
        break;
      } catch {
        if (attempt >= RETRY_ATTEMPTS) throw new Error("retry.handRolled exhausted unexpectedly.");
      }
    }
  });

  bench("retry.opWithRetry", async () => {
    let attempt = 0;
    const result = await Op.try(() => {
      attempt += 1;
      if (attempt < RETRY_ATTEMPTS) throw new Error("retry");
      return 1;
    })
      .withRetry({
        maxAttempts: RETRY_ATTEMPTS,
        shouldRetry: () => true,
        getDelay: () => 0,
      })
      .run();
    if (!result.isOk()) throw new Error("retry.opWithRetry failed unexpectedly.");
  });
});

describe("timeout", () => {
  bench("timeout.promiseRace", async () => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        reject(new Error("timeout should not fire"));
      }, TIMEOUT_BUDGET_MS);
    });
    await Promise.race([Promise.resolve(7), timer]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });

  bench("timeout.opWithTimeout", async () => {
    const result = await Op.of(7).withTimeout(TIMEOUT_BUDGET_MS).run();
    if (!result.isOk()) throw new Error("timeout.opWithTimeout failed unexpectedly.");
  });
});

describe("compose", () => {
  bench("compose.asyncSteps", async () => {
    await runAsyncChain();
  });

  bench("compose.asyncFnChain", async () => {
    await runAsyncFnChain();
  });

  bench("compose.opYieldChain", async () => {
    await runOpYieldChain(op);
  });

  bench("compose.opFlatLoop", async () => {
    await runOpFlatLoop(op);
  });

  bench("compose.opSequentialRuns", async () => {
    await runOpSequentialRuns(op);
  });

  bench("compose.rawSyncYieldStar", () => {
    runRawSyncYieldStarChain();
  });
});

describe("single-op-micro", () => {
  bench("single-op-micro.opRun", async () => {
    const result = await Op.of(69).run();
    if (!result.isOk()) throw new Error("single-op-micro.opRun failed unexpectedly.");
  });
});
