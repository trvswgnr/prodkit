import { TimeoutError, UnhandledException } from "../../errors.js";
import { Result } from "../../result.js";
import { unsafeCoerce } from "../../shared.js";
import { RegisterExitFinalizerInstruction, SuspendInstruction } from "../instructions.js";
import type { EnterContext, EnterFn, ExitContext, ExitFn, ReleaseFn } from "../types.js";
import { createPlan, type Plan } from "./base.js";

export function withReleasePlan<T, E, M>(
  source: Plan<T, E, M>,
  release: ReleaseFn<T>,
): Plan<T, E, M> {
  const build = (inner: Plan<T, E, M>) => withReleasePlan(inner, release);

  return createPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      if (result.isErr()) return yield* result;

      yield new RegisterExitFinalizerInstruction(() =>
        Promise.resolve(release(result.value)).then(() => {}),
      );

      return result.value;
    },
    {
      withRetry: (policy) => build(source.withRetry(policy)),
      withTimeout: (timeoutMs) => withReleasePlan(source.withTimeout(timeoutMs), release),
      withSignal: (signal) => build(source.withSignal(signal)),
    },
  );
}

export function onEnterPlan<T, E, A, M>(
  source: Plan<T, E, M>,
  initialize: EnterFn<A>,
): Plan<T, E, M> {
  const build = (inner: Plan<T, E, M>) => onEnterPlan(inner, initialize);

  return createPlan(
    function* () {
      yield new SuspendInstruction(async (context) => {
        const enterCtx: EnterContext<A> = {
          signal: context.signal,
          // SAFETY: this plan is bound by the op shell for the same tuple arity `A`.
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
    {
      withRetry: (policy) => build(source.withRetry(policy)),
      withTimeout: (timeoutMs) => onEnterPlan(source.withTimeout(timeoutMs), initialize),
      withSignal: (signal) => build(source.withSignal(signal)),
    },
  );
}

export function onExitPlan<T, E, A, M>(
  source: Plan<T, E, M>,
  finalize: ExitFn<T, E, A>,
): Plan<T, E, M> {
  const build = (inner: Plan<T, E, M>) => onExitPlan(inner, finalize);

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

      const result: Result<T, E | UnhandledException> = yield* new SuspendInstruction((context) =>
        source.execute(context),
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    {
      withRetry: (policy) => build(source.withRetry(policy)),
      withTimeout: (timeoutMs) =>
        onExitPlan(
          source.withTimeout(timeoutMs),
          finalize as unknown as ExitFn<T, E | TimeoutError, A>,
        ),
      withSignal: (signal) => build(source.withSignal(signal)),
    },
  );
}
