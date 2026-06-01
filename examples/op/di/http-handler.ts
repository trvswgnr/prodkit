import { Op } from "@prodkit/op";
import { DI } from "@prodkit/op/di";
import { TaggedError } from "better-result";
import * as v from "valibot";

export type PoolConnection = { connId: string };

export type UserProfile = {
  userId: string;
  displayName: string;
};

export type HttpRequest = {
  method: string;
  path: string;
  body: unknown;
};

export type HttpResponse = {
  status: number;
  body: unknown;
};

const GetUserRequest = v.object({
  method: v.literal("GET"),
  path: v.pipe(v.string(), v.regex(/^\/users\/([^/]+)$/)),
  body: v.optional(v.null()),
});

type NonEmptyArray<T> = [T, ...T[]];

export class InvalidRequestError extends TaggedError("InvalidRequestError")<{
  issues: NonEmptyArray<v.InferIssue<typeof GetUserRequest>>;
}>() {}

export class PoolCheckoutError extends TaggedError("PoolCheckoutError")<{ cause?: unknown }>() {}

export class UserLookupError extends TaggedError("UserLookupError")<{
  userId: string;
  cause?: unknown;
}>() {}

export class UserNotFoundError extends TaggedError("UserNotFoundError")<{ userId: string }>() {}

export interface ConnectionPool {
  checkout(signal: AbortSignal): Promise<PoolConnection>;
  release(conn: PoolConnection, signal: AbortSignal): Promise<void>;
}

export interface UserRepository {
  findById: Op<UserProfile | null, UserLookupError, [conn: PoolConnection, userId: string]>;
}

export class ConnectionPoolService extends DI.Dependency("ConnectionPoolService")<ConnectionPool> {}

export class PoolConnectionService extends DI.Dependency("PoolConnectionService")<PoolConnection> {}

export class UserRepositoryService extends DI.Dependency("UserRepositoryService")<UserRepository> {}

function userIdFromValidatedPath(path: string): string {
  const match = /^\/users\/([^/]+)$/.exec(path);
  if (match === null) {
    throw new Error("validated path missing user id segment");
  }
  return match[1];
}

export const parseGetUserRequest = Op(function* (request: HttpRequest) {
  const parsed = v.safeParse(GetUserRequest, request);
  if (!parsed.success) {
    return yield* new InvalidRequestError({ issues: parsed.issues });
  }
  return userIdFromValidatedPath(parsed.output.path);
});

export const loadUser = Op(function* (conn: PoolConnection, userId: string) {
  const users = yield* DI.inject(UserRepositoryService);
  const row = yield* users.findById(conn, userId);
  if (row === null) return yield* new UserNotFoundError({ userId });
  return row;
});

export const handleGetUser = Op(function* (request: HttpRequest) {
  const userId = yield* parseGetUserRequest(request);

  const pool = yield* DI.inject(ConnectionPoolService);
  const conn = yield* DI.inject(PoolConnectionService);
  yield* Op.defer((ctx) => pool.release(conn, ctx.signal));

  const user = yield* loadUser(conn, userId);
  return { status: 200, body: user } satisfies HttpResponse;
});

export function runnableHandleGetUser(pool: ConnectionPool, users: UserRepository) {
  const op = DI.provide(handleGetUser, [
    DI.singleton(ConnectionPoolService, pool),
    DI.singleton(UserRepositoryService, users),
    DI.scoped(PoolConnectionService, (signal) => pool.checkout(signal)),
  ]);

  return { op };
}
