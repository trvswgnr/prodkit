import { genPlan } from "./plan/base.js";
import { makeBoundPlanOp } from "./plan/shell.js";
import type { TrackedErr } from "./plan/surface.js";
import type { Instruction } from "./instructions.js";
import type { EmptyMeta } from "./meta.js";
import type { Op } from "../index.js";

/** Builds a nullary generator leaf op backed by the internal plan model. */
export function makeCoreOp<T, E, M = EmptyMeta>(
  gen: () => Generator<Instruction<E, M>, T, unknown>,
): Op<T, TrackedErr<E>, [], M> {
  return makeBoundPlanOp(() => genPlan(gen));
}
