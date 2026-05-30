import { assert, describe, expect, test, vi } from "vitest";
import { Delay, Op, TimeoutError } from "../../src/index.js";
import { TaggedError, UnhandledException } from "../../src/errors.js";
import { Result } from "../../src/result.js";
import { resolveAfter } from "../support/utils.js";

describe("OpFactory", () => {
  test("type is 'OpFactory'", () => {
    expect(Op._tag).toBe("OpFactory");
  });

  test("run is a function", () => {
    expect(Op.run).toBeInstanceOf(Function);
  });

  test("pure is a function", () => {
    expect(Op.of).toBeInstanceOf(Function);
  });

  test("sleep is a function", () => {
    expect(Op.sleep).toBeInstanceOf(Function);
  });

  test("empty is a stable singleton op", async () => {
    expect(Op.empty).toBe(Op.empty);

    const result = await Op.empty.run();
    assert(result.isOk(), "should be Ok");
    expect(result.value).toBeUndefined();
  });
});

describe("Delay", () => {
  test("is exported and produces exponential delays", () => {
    const delay = Delay.exponential({ baseMs: 100, maxMs: 1000, jitter: 0 });
    expect(delay(1, undefined)).toBe(100);
    expect(delay(2, undefined)).toBe(200);
    expect(delay(3, undefined)).toBe(400);
    expect(delay(5, undefined)).toBe(1000);
  });

  test("default retry delay is exported", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(1);
    try {
      expect(Delay.defaultRetry).toBeInstanceOf(Function);
      expect(Delay.defaultRetry(1, undefined)).toBe(1_000);
      expect(Delay.defaultRetry(2, undefined)).toBe(2_000);
      expect(Delay.defaultRetry(5, undefined)).toBe(16_000);
      expect(Delay.defaultRetry(6, undefined)).toBe(30_000);
    } finally {
      randomSpy.mockRestore();
    }
  });

  test("invalid exponential delay policy fails at run time", async () => {
    const result = await Op.of("ok")
      .withRetry({
        delay: Delay.exponential({ baseMs: 0 }),
      })
      .run();

    assert(result.isErr(), "should be Err");
    expect(result.error).toBeInstanceOf(UnhandledException);
    expect(result.error.cause).toBeInstanceOf(RangeError);
  });
});

describe("UnhandledException", () => {
  test("discriminant and cause", () => {
    const cause = new Error("root");
    const e = new UnhandledException({ cause });
    expect(e._tag).toBe("UnhandledException");
    expect(e.message).toBe("Unhandled exception: root");
    expect(e.cause).toBe(cause);
  });
});

describe("TaggedError", () => {
  test("factory produces typed errors", () => {
    const SmokeError = TaggedError("SmokeError")<{ message: string }>();
    const e = new SmokeError({ message: "x" });
    expect(e._tag).toBe("SmokeError");
    expect(e.name).toBe("SmokeError");
    expect(e.message).toBe("x");
  });
});

describe("Op.of / Op.fail", () => {
  test("pure does not yield errors; fail does not", async () => {
    const okR = await Op.of(7).run();
    assert(okR.isOk(), "should be Ok");
    expect(okR.value).toBe(7);

    const errR = await Op.fail("no").run();
    assert(errR.isErr(), "should be Err");
    expect(errR.error).toBe("no");
  });
});

describe("Op.try", () => {
  test("resolve and mapped reject", async () => {
    const okR = await Op.try(
      () => Promise.resolve(3),
      () => "mapped",
    ).run();
    assert(okR.isOk(), "should be Ok");
    expect(okR.value).toBe(3);

    const errR = await Op.try(
      () => (Math.random() > 1 ? Promise.resolve(3) : Promise.reject("boom")),
      (e) => ({ mappedError: String(e) }),
    ).run();
    assert(errR.isErr(), "should be Err");
    expect(errR.error).toEqual({ mappedError: "boom" });
  });
});

describe("Op.run", () => {
  test("free-function run executes nullary ops", async () => {
    const r1 = await Op.run(Op.of(69));
    assert(r1.isOk(), "should be Ok");
    expect(r1.value).toBe(69);

    const nullary = Op(function* () {
      return 1;
    });
    const r2 = await Op.run(nullary());
    assert(r2.isOk(), "should be Ok");
    expect(r2.value).toBe(1);
  });

  test("free-function run forwards runtime args", async () => {
    const add = Op(function* (a: number, b: number) {
      return a + b;
    });

    const result = await Op.run(add, 30, 39);

    assert(result.isOk(), "should be Ok");
    expect(result.value).toBe(69);
  });
});

describe("Op namespace value", () => {
  test('callable Op has type discriminant Typed<"Op">', () => {
    const p = Op(function* () {
      return yield* Op.of(1);
    });
    expect(p._tag).toBe("Op");
  });

  test("calling a nullary op returns another runnable op", async () => {
    const op = Op.of(69);
    const result = await op()().run();

    assert(result.isOk(), "should be Ok");
    expect(result.value).toBe(69);
  });

  test("yield* can consume a generic helper that returns Op(function*)", async () => {
    type Parsed = { version: string };
    const runTest = async (lift: (value: Parsed) => Op<Parsed, never, []>) => {
      const program = Op(function* () {
        const parsedValue = yield* lift({ version: "1.2.3" });
        return parsedValue;
      });

      const result = await program.run();
      expect(result).toEqual(Result.ok({ version: "1.2.3" }));
    };

    const fns = [
      <T>(t: T) =>
        Op(function* () {
          return t;
        })(),
      <T>(t: T) => Op.of(t),
      <T>(t: T) => Op.of(Promise.resolve(t)),
      <T>(t: T) => Op.empty.map(() => t),
      <T>(t: T) => Op.try(() => t),
      <T>(t: T) => Op.try(() => Promise.resolve(t)),
      <T>(t: T) =>
        Op.fail(null).recover(
          (e): e is null => e === null,
          () => t,
        ),
      <T>(t: T) => Op.empty.flatMap(() => Op.of(t)),
      <T>(t: T) => Op.all([Op.of(t)]).map(([x]) => x),
      <T>(t: T) => Op.allSettled([Op.of(t)]).map(([x]) => x.unwrap()),
      <T>(t: T) => Op.settle(Op.of(t)).map((x) => x.unwrap()),
      <T>(t: T) => Op.race([Op.of(t)]),
      <T>(t: T) => Op.any([Op.fail(null), Op.of(t)]),
    ];

    await Promise.all(fns.map(runTest));
  });
});

describe("Op combinators compose with withTimeout / withRetry", () => {
  test("Op.all().withTimeout() times out the whole fan-out", async () => {
    vi.useFakeTimers();
    try {
      const slow = Op.try(() => resolveAfter(1000, 1000));
      const promise = Op.all([slow, slow]).withTimeout(10).run();
      await vi.advanceTimersByTimeAsync(15);
      const r = await promise;
      assert(r.isErr(), "should be Err");
      expect(r.error).toBeInstanceOf(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Op.any().withRetry() retries the whole combinator", async () => {
    let attempts = 0;
    const flaky = Op(function* () {
      attempts += 1;
      if (attempts < 2) return yield* Op.fail("nope" as const);
      return yield* Op.of(11);
    });
    const r = await Op.any([flaky()])
      .withRetry({ attempts: 3, when: () => true, delay: () => 0 })
      .run();
    assert(r.isOk(), "should be Ok");
    expect(r.value).toBe(11);
    expect(attempts).toBe(2);
  });
});
