import { assert, describe, expect, test } from "vitest";
import { Op } from "../../../src/index.js";

describe("Op.settle", () => {
  test("wraps success in a settled Result", async () => {
    const r = await Op.settle(Op.of(69)).run();
    assert(r.isOk(), "should be Ok");
    const settled = r.value;
    assert(settled.isOk(), "should be Ok");
    expect(settled.value).toBe(69);
  });

  test("wraps failure in a settled Result", async () => {
    const r = await Op.settle(Op.fail("nope")).run();
    assert(r.isOk(), "should be Ok");
    const settled = r.value;
    assert(settled.isErr(), "should be Err");
    expect(settled.error).toBe("nope");
  });

  test("preserves child result typing", async () => {
    const combined = Op.settle(Op.fail(1));
    const r = await combined.run();
    assert(r.isOk(), "should be Ok");
    expect(r.value.isErr()).toBe(true);
  });
});
