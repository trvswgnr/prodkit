import { Op } from "@prodkit/op";
import { UnhandledException } from "better-result";
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
} from "./sample.ts";
import { assert } from "../../support/assert.ts";
import { Policy } from "@prodkit/op/policy";

function isNamedUser(value: unknown): value is { name: string } {
  return (
    typeof value === "object" && value !== null && "name" in value && typeof value.name === "string"
  );
}

export async function runSimpleExampleSmoke() {
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
    .with(Policy.cancel(controller.signal))
    .run();
  controller.abort("poll cancelled");
  const cancelledPoll = await cancelledPollPromise;
  assert(cancelledPoll.isErr(), "cancelled poll should fail");
  assert(
    cancelledPoll.error instanceof UnhandledException,
    "cancelled poll should surface cancellation as UnhandledException",
  );
}
