import { assert, describe, expect, test, vi } from "vitest";
import { ErrorGroup, Op } from "../../src/index.js";
import { deferredPromise, neverSettling, rejectAfter, settleOutcome } from "../support/utils.js";
import { identity } from "../../src/shared.js";

describe("Op.any", () => {
  test("returns first success and aborts siblings", async () => {
    let slowAborted = false;
    const slow = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          const t = setTimeout(() => resolve(99), 50);
          signal.addEventListener("abort", () => {
            slowAborted = true;
            clearTimeout(t);
            resolve(-1);
          });
        }),
    );
    const r = await Op.any([slow, Op.of(69)]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(69);
    expect(slowAborted).toBe(true);
  });

  test("first success can be undefined", async () => {
    const r = await Op.any([Op.of(undefined), Op.of(1)]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBeUndefined();
  });

  test("all-fail surfaces ErrorGroup with errors in input order", async () => {
    const r = await Op.any([Op.fail("a"), Op.fail("b"), Op.fail("c")]).run();
    assert(r.isErr(), "should be Err");
    assert(ErrorGroup.is(r.error), "should be ErrorGroup");
    expect(r.error.errors).toEqual(["a", "b", "c"]);
  });

  test("empty input fails with empty ErrorGroup", async () => {
    const r = await Op.any([]).run();
    assert(r.isErr(), "should be Err");
    assert(ErrorGroup.is(r.error), "should be ErrorGroup");
    expect(r.error.errors).toEqual([]);
  });

  test("error type is ErrorGroup<union of child errors>", async () => {
    const combined = Op.any([Op.fail(1), Op.fail("two")]);
    const r = await combined.run();
    assert(r.isErr(), "should be Err");
    assert(ErrorGroup.is(r.error), "should be ErrorGroup");
    expect(r.error.errors).toEqual([1, "two"]);
  });

  test("preserves index order when failures settle out of order", async () => {
    const toTag =
      <T extends string>(tag: T) =>
      (_: unknown): T =>
        tag;
    const r = await Op.any([
      Op.try(() => rejectAfter("slow", 10), toTag("slow")),
      Op.try(() => rejectAfter("fast", 0), toTag("fast")),
    ]).run();
    assert(r.isErr(), "should be Err");
    assert(ErrorGroup.is(r.error), "ErrorGroup");
    expect(r.error.errors).toEqual(["slow", "fast"]);
  });

  test("waits for loser finalization before returning the winner", async () => {
    const loserCleanupGate = deferredPromise<void>();
    let loserCleanupStarted = false;
    const loser = Op(function* () {
      yield* Op.defer(async () => {
        loserCleanupStarted = true;
        await loserCleanupGate.promise;
      });
      yield* Op.try(neverSettling);
    });

    const run = Op.any([loser, Op.of(7)]).run();
    let settled = false;
    void run.then(() => (settled = true));

    await vi.waitFor(() => expect(loserCleanupStarted).toBe(true));
    expect(settled).toBe(false);

    loserCleanupGate.resolve();
    const r = await run;

    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(7);
  });

  test("winner success keeps precedence over loser abort-time failures", async () => {
    const loser = Op.try(
      (signal) =>
        new Promise<number>((_, reject) =>
          signal.addEventListener("abort", () => reject("cleanup-failed"), { once: true }),
        ),
      identity,
    );

    const r = await Op.any([loser, Op.of(1)]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(1);
  });

  test("settles when a winner succeeds and a loser ignores abort", async () => {
    const run = Op.any([Op.try(neverSettling), Op.of(7)]).run();
    expect(await settleOutcome(run)).toBe("settled");
    const r = await run;
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(7);
  });
});
