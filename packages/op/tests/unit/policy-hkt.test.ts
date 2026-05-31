import { describe, expect, expectTypeOf, test } from "vitest";
import type { HKT } from "../../src/hkt.js";
import { Op, type Op as OpType } from "../../src/index.js";
import { Policy, type OpPolicy } from "../../src/policy/index.js";
import { Result } from "../../src/result.js";

type PolicyRejected<Reason extends string> = {
  readonly _tag: "PolicyRejected";
  readonly reason: Reason;
};

interface RejectWhenPolicyType<Reason extends string> extends HKT {
  readonly [HKT.TYPE]: OpType<
    HKT.Param<this, 0>,
    HKT.Param<this, 1> | PolicyRejected<Reason>,
    HKT.Param<this, 2>,
    HKT.Param<this, 3>
  >;
}

function rejectWhen<Reason extends string>(
  shouldReject: boolean,
  reason: Reason,
): OpPolicy<unknown, RejectWhenPolicyType<Reason>> {
  return Policy.define<unknown, RejectWhenPolicyType<Reason>>({
    apply: (source) => {
      if (shouldReject) {
        return source.around(async () => {
          return Result.err({ _tag: "PolicyRejected", reason } as const);
        });
      }

      return source.around((next, context) => {
        return next(context);
      });
    },
  });
}

describe("policy HKT protocol", () => {
  test("custom policies widen the error channel without a .with overload", () => {
    const guarded = Op(function* (id: string) {
      return id.length;
    }).with(rejectWhen(false, "closed"));

    expectTypeOf(guarded).toEqualTypeOf<OpType<number, PolicyRejected<"closed">, [id: string]>>();

    const failed = Op.fail("bad" as const).with(rejectWhen(false, "closed"));

    expectTypeOf(failed).toEqualTypeOf<OpType<never, "bad" | PolicyRejected<"closed">, []>>();
  });

  test("release still contextually types the success value", () => {
    Op.of({ id: 1 }).with(
      Policy.release((value) => {
        expectTypeOf(value).toEqualTypeOf<{ id: number }>();
      }),
    );
  });

  test("custom policies can short-circuit at runtime", async () => {
    const result = await Op.of(1).with(rejectWhen(true, "closed")).run();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual({ _tag: "PolicyRejected", reason: "closed" });
    }
  });

  test("custom policies can delegate to the wrapped operation", async () => {
    const result = await Op.of(1).with(rejectWhen(false, "closed")).run();

    expect(result.unwrap()).toBe(1);
  });
});
