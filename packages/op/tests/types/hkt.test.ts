import { describe, expectTypeOf, test } from "vitest";
import { HKT_RESULT, type Apply, type HKT, type HKTArg } from "../../src/hkt.js";

type PairRecord<Self> = {
  readonly first: HKTArg<Self, 0>;
  readonly second: HKTArg<Self, 1>;
};

interface PairToRecord extends HKT {
  readonly [HKT_RESULT]: PairRecord<this>;
}

describe("generic HKT helpers", () => {
  test("Apply passes type arguments through a reusable type constructor", () => {
    expectTypeOf<Apply<PairToRecord, readonly ["id", number]>>().toEqualTypeOf<{
      readonly first: "id";
      readonly second: number;
    }>();
  });
});
