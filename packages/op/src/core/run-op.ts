import { UnhandledException } from "../errors.js";
import type { Result } from "../result.js";
import { createRunContext, drive } from "./runtime.js";
import type { Op } from "../index.js";

export function runOp<T, E, M>(op: Op<T, E, [], M>): Promise<Result<T, E | UnhandledException>> {
  return drive(op, createRunContext(new AbortController().signal));
}
