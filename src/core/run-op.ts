import { UnhandledException } from "../errors.js";
import type { Result } from "../result.js";
import type { _Op } from "./types.js";
import { drive } from "./runtime.js";

export function runOp<T, E>(op: _Op<T, E, []>): Promise<Result<T, E | UnhandledException>> {
  return drive(op, new AbortController().signal);
}
