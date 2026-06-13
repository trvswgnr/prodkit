import {
  InvalidRequestError,
  PoolCheckoutError,
  UserLookupError,
  UserNotFoundError,
  runnableHandleGetUser,
} from "./sample.ts";
import { assert } from "../../../support/assert.ts";
import { Op } from "@prodkit/op";
import { UnhandledException } from "better-result";

export async function runHttpHandlerExampleSmoke() {
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
