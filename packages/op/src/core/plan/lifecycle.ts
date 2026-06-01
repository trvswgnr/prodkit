import { UnhandledException } from "../../errors.js";
import { Result } from "../../result.js";
import { unsafeCoerce } from "../../shared.js";
import {
  RegisterExitFinalizerInstruction,
  SuspendInstruction,
  SuspendResume,
} from "../instructions.js";
import type { EnterContext, EnterFn, ExitFn } from "./context.js";
import type { ExitContext } from "../runtime.js";
import { createPlan, type Plan } from "./base.js";

export function onEnterPlan<T, E, A, M>(
  source: Plan<T, E, M>,
  initialize: EnterFn<A>,
): Plan<T, E, M> {
  return createPlan(
    function* () {
      yield new SuspendInstruction(async (context) => {
        const enterCtx: EnterContext<A> = {
          signal: context.signal,
          // SAFETY: this plan is bound by the op shell for the same tuple arity `A`.
          args: unsafeCoerce(context.args),
        };
        await Promise.resolve(initialize(enterCtx));
      }, SuspendResume.passThrough);

      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (context) => source.execute(context),
        SuspendResume.passThrough,
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (self, rewriter) => rewriter.enter?.(source, initialize) ?? rewriter.apply(self),
    },
  );
}

export function onExitPlan<T, E, A, M>(
  source: Plan<T, E, M>,
  finalize: ExitFn<T, E, A>,
): Plan<T, E, M> {
  return createPlan(
    function* () {
      yield new RegisterExitFinalizerInstruction(async (ctx) => {
        const exitCtx: ExitContext<T, E, A> = {
          signal: ctx.signal,
          // SAFETY: this finalizer is registered by the plan that produced the result type `T | E`.
          result: unsafeCoerce(ctx.result),
          // SAFETY: this plan is bound by the op shell for the same tuple arity `A`.
          args: unsafeCoerce(ctx.args),
        };
        await Promise.resolve(finalize(exitCtx));
      });

      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction(
        (context) => source.execute(context),
        SuspendResume.passThrough,
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      rewrite: (self, rewriter) => rewriter.exit?.(source, finalize) ?? rewriter.apply(self),
    },
  );
}
