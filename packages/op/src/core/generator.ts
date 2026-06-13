import { genPlan } from "../plan/model.js";
import { makeBoundPlanOp } from "./shell.js";
import type { TrackedErr } from "./surface.js";
import type { Instruction } from "../execution/instructions.js";
import type { EmptyMeta } from "./metadata.js";
import type { Op } from "../index.js";

/** Builds a nullary generator leaf op backed by the internal plan model. */
export function makeCoreOp<T, E, M = EmptyMeta>(
  gen: () => Generator<Instruction<E, M>, T, unknown>,
): Op<T, TrackedErr<E>, [], M> {
  return makeBoundPlanOp(() => genPlan(gen));
}
