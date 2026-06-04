import { UnhandledException } from "../../errors.js";
import { Result } from "../../result.js";
import { unsafeCoerce } from "@prodkit/shared/runtime";
import { RegisterExitFinalizerInstruction, SuspendInstruction } from "../instructions.js";
import type { EnterContext, EnterFn, ExitFn } from "./context.js";
import type { ExitContext } from "../runtime.js";
import { createUnaryPlan, type Plan } from "./base.js";

export function onEnterPlan<T, E, A, M>(
  source: Plan<T, E, M>,
  initialize: EnterFn<A>,
): Plan<T, E, M> {
  return createUnaryPlan(
    function* () {
      yield new SuspendInstruction(async (context) => {
        const enterCtx: EnterContext<A> = {
          signal: context.signal,
          // SAFETY: RunContext stores args as readonly unknown[]; they are the tuple from this op's invocation.
          args: unsafeCoerce(context.args),
        };
        await Promise.resolve(initialize(enterCtx));
      });

      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    source,
    (inner) => onEnterPlan(inner, initialize),
  );
}

export function onExitPlan<T, E, A, M>(
  source: Plan<T, E, M>,
  finalize: ExitFn<T, E, A>,
): Plan<T, E, M> {
  return createUnaryPlan(
    function* () {
      yield new RegisterExitFinalizerInstruction(async (ctx) => {
        const exitCtx: ExitContext<T, E, A> = {
          signal: ctx.signal,
          // SAFETY: ExitFinalizerContext erases result; this hook is registered by the enclosing plan for T, E.
          result: unsafeCoerce(ctx.result),
          // SAFETY: RunContext stores args as readonly unknown[]; they are the tuple from this op's invocation.
          args: unsafeCoerce(ctx.args),
        };
        await Promise.resolve(finalize(exitCtx));
      });

      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    source,
    (inner) => onExitPlan(inner, finalize),
  );
}
