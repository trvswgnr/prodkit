import { Op, TimeoutError } from "@prodkit/op";
import { TaggedError, UnhandledException } from "better-result";
import { assert } from "../assert.ts";
import { Policy } from "@prodkit/op/policy";

export async function runCoreApiSmoke() {
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
        retries: 1,
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
