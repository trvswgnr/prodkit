import { UnhandledException } from "../../errors.js";
import { Result } from "../../result.js";
import { SuspendInstruction } from "../instructions.js";
import type { RunContext } from "../runtime.js";
import { createPlan, type Plan } from "./base.js";
import { driveAllPlans } from "./fan-out.js";

export function allPlan<T, E, M>(
  children: readonly Plan<T, E, M>[],
  concurrency?: number,
): Plan<T[], E, M> {
  const snapshot = children.slice();

  return createPlan(
    function* () {
      const result: Result<T[], E | UnhandledException> = yield* new SuspendInstruction(
        (outerContext: RunContext<readonly unknown[]>) =>
          driveAllPlans(snapshot, outerContext, concurrency),
        true,
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (self, rewriter) => rewriter.all?.(snapshot, concurrency) ?? rewriter.apply(self),
    },
  );
}
