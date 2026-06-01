import { assert, describe, expect, test } from "vitest";
import { Op } from "../../src/index.js";
import { UnhandledException } from "../../src/errors.js";
import { invalidConcurrencies } from "../support/utils.js";

describe("Op.allSettled", () => {
  test("returns tuple of Result in input order", async () => {
    const r = await Op.allSettled([Op.of(1), Op.fail("no"), Op.of("ok")]).run();
    assert(r.isOk(), "should be Ok");
    const [a, b, c] = r.value;
    assert(a.isOk() && b.isErr() && c.isOk(), "branches should be Ok, Err, Ok");
    expect(a.value).toBe(1);
    expect(b.error).toBe("no");
    expect(c.value).toBe("ok");
  });

  test("empty input succeeds with []", async () => {
    const r = await Op.allSettled([]).run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toEqual([]);
  });

  test.each(invalidConcurrencies)(
    "invalid concurrency %s returns UnhandledException",
    async (concurrency) => {
      const r = await Op.allSettled([Op.of(1)], concurrency).run();
      assert(r.isErr(), "should be Err");
      expect(r.error).toBeInstanceOf(UnhandledException);
      expect(r.error.cause).toEqual(new RangeError("concurrency must be a positive integer"));
    },
  );

  test("never fails", async () => {
    const combined = Op.allSettled([Op.fail(1), Op.fail("two")]);
    const r = await combined.run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toHaveLength(2);
  });

  test("does not abort siblings on failure", async () => {
    let siblingAborted = false;
    const slow = Op.try(
      (signal) =>
        new Promise<number>((resolve) => {
          const t = setTimeout(() => resolve(1), 10);
          signal.addEventListener("abort", () => {
            siblingAborted = true;
            clearTimeout(t);
            resolve(-1);
          });
        }),
    );
    const r = await Op.allSettled([slow, Op.fail("boom")]).run();
    assert(r.isOk(), "should be Ok");
    expect(siblingAborted).toBe(false);
    const [first] = r.value;
    assert(first.isOk(), "first should be Ok");
    expect(first.value).toBe(1);
  });

  test("limits active children and keeps draining after failures", async () => {
    const started: number[] = [];
    const first = Op(function* () {
      started.push(0);
      return yield* Op.fail("boom");
    });
    const second = Op(function* () {
      started.push(1);
      return yield* Op.of("ok");
    });

    const r = await Op.allSettled([first, second], 1).run();

    assert(r.isOk(), "should be Ok");
    expect(started).toEqual([0, 1]);
    const [a, b] = r.value;
    assert(a.isErr() && b.isOk(), "branches should be Err, Ok");
    expect(a.error).toBe("boom");
    expect(b.value).toBe("ok");
  });
});
