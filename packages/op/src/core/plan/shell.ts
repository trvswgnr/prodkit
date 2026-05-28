import { TimeoutError } from "../../errors.js";
import { OP_BOUND_BRAND, OP_BRAND, unsafeCoerce } from "../../shared.js";
import { createRunContext } from "../runtime.js";
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from "../retry-policy.js";
import type {
  AnyNullaryOp,
  BypassedErr,
  EmptyMeta,
  EnterFn,
  ExitFn,
  InferOpErr,
  InferOpMeta,
  InferOpOk,
  MergeMeta,
  OpInterface,
  OpLifecycleHook,
  ReleaseFn,
  TrackedErr,
} from "../types.js";
import { OP_PLAN_BIND, type Plan, type PlanBinder } from "./base.js";
import { onEnterPlan, onExitPlan, withReleasePlan } from "./lifecycle.js";
import {
  flatMapPlan,
  mapErrPlan,
  mapPlan,
  recoverPlan,
  tapErrPlan,
  tapPlan,
} from "./transforms.js";

export function makePlanOp<
  T,
  E,
  A extends readonly unknown[],
  M = EmptyMeta,
  Yieldable extends boolean = A extends [] ? true : false,
>(
  bindArgs: PlanBinder<T, E, A, M>,
  makeIterable?: () => Plan<T, E, M>,
  bound = false,
): OpInterface<T, E, A, M, Yieldable> {
  let self: OpInterface<T, E, A, M, Yieldable>;
  const invoke = bound
    ? () => self
    : (...args: A) =>
        makePlanOp<T, E, [], M, true>(
          () => bindArgs(...args),
          () => bindArgs(...args),
          true,
        );

  const iterable =
    makeIterable ??
    (bound
      ? () =>
          bindArgs(
            // SAFETY: bound plan ops are always nullary at the public call surface.
            ...unsafeCoerce<A>([]),
          )
      : undefined);

  const withPolicyIterable = <TNext, ENext, MNext>(
    transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
  ) => (iterable === undefined ? undefined : () => transform(iterable()));

  // SAFETY: Object.assign decorates the runtime callable with the Op method surface and
  // internal plan binder. The callable and method signatures are supplied by the generic inputs.
  self = unsafeCoerce(
    Object.assign(invoke, {
      [OP_PLAN_BIND]: bindArgs,
      run: (...args: A) =>
        bindArgs(...args).execute(createRunContext(new AbortController().signal, args)),
      withRetry: (policy?: RetryPolicy) => {
        const retryPolicy = policy ?? DEFAULT_RETRY_POLICY;
        return makePlanOp<T, E, A, M, Yieldable>(
          (...args) => bindArgs(...args).withRetry(retryPolicy),
          withPolicyIterable((plan) => plan.withRetry(retryPolicy)),
          bound,
        );
      },
      withTimeout: (timeoutMs: number) =>
        makePlanOp<T, E | TimeoutError, A, M, Yieldable>(
          (...args) => bindArgs(...args).withTimeout(timeoutMs),
          withPolicyIterable((plan) => plan.withTimeout(timeoutMs)),
          bound,
        ),
      withSignal: (signal: AbortSignal) =>
        makePlanOp<T, E, A, M, Yieldable>(
          (...args) => bindArgs(...args).withSignal(signal),
          withPolicyIterable((plan) => plan.withSignal(signal)),
          bound,
        ),
      withRelease: (release: ReleaseFn<T>) =>
        makePlanOp<T, E, A, M, Yieldable>(
          (...args) => withReleasePlan(bindArgs(...args), release),
          withPolicyIterable((plan) => withReleasePlan(plan, release)),
          bound,
        ),
      on: (event: OpLifecycleHook, handler: unknown) => {
        if (event === "enter") {
          const initialize = handler as EnterFn<A>;
          return makePlanOp<T, E, A, M, Yieldable>(
            (...args) => onEnterPlan(bindArgs(...args), initialize),
            withPolicyIterable((plan) => onEnterPlan(plan, initialize)),
            bound,
          );
        }

        if (event === "exit") {
          const finalize = handler as ExitFn<T, E, A>;
          return makePlanOp<T, E, A, M, Yieldable>(
            (...args) => onExitPlan(bindArgs(...args), finalize),
            withPolicyIterable((plan) => onExitPlan(plan, finalize)),
            bound,
          );
        }

        throw new Error(`Invalid event: ${event}`);
      },
      map: <U>(transform: (value: T) => U) =>
        makePlanOp<Awaited<U>, E, A, M, Yieldable>(
          (...args) => mapPlan(bindArgs(...args), transform),
          withPolicyIterable((plan) => mapPlan(plan, transform)),
          bound,
        ),
      mapErr: <E2>(transform: (error: TrackedErr<E>) => E2) =>
        makePlanOp<T, E2 | BypassedErr<E>, A, M, Yieldable>(
          (...args) => mapErrPlan(bindArgs(...args), transform),
          withPolicyIterable((plan) => mapErrPlan(plan, transform)),
          bound,
        ),
      flatMap: <R extends AnyNullaryOp>(bind: (value: T) => R) =>
        makePlanOp<InferOpOk<R>, E | InferOpErr<R>, A, MergeMeta<M, InferOpMeta<R>>, Yieldable>(
          (...args) => flatMapPlan(bindArgs(...args), bind),
          withPolicyIterable((plan) => flatMapPlan(plan, bind)),
          bound,
        ),
      tap: <R>(observe: (value: T) => R) =>
        makePlanOp<T, E | InferOpErr<R>, A, MergeMeta<M, InferOpMeta<R>>, Yieldable>(
          (...args) => tapPlan(bindArgs(...args), observe),
          withPolicyIterable((plan) => tapPlan(plan, observe)),
          bound,
        ),
      tapErr: <R>(observe: (error: TrackedErr<E>) => R) =>
        makePlanOp<
          T,
          TrackedErr<E> | BypassedErr<E> | InferOpErr<R>,
          A,
          MergeMeta<M, InferOpMeta<R>>,
          Yieldable
        >(
          (...args) => tapErrPlan(bindArgs(...args), observe),
          withPolicyIterable((plan) => tapErrPlan(plan, observe)),
          bound,
        ),
      recover: <ECaught extends TrackedErr<E>, R>(
        predicate: (error: TrackedErr<E>) => error is ECaught,
        handler: (error: ECaught) => R,
      ) =>
        makePlanOp<
          T | InferOpOk<R>,
          TrackedErr<E, ECaught> | BypassedErr<E> | InferOpErr<R>,
          A,
          MergeMeta<M, InferOpMeta<R>>,
          Yieldable
        >(
          (...args) => recoverPlan(bindArgs(...args), predicate, handler),
          withPolicyIterable((plan) => recoverPlan(plan, predicate, handler)),
          bound,
        ),
      [OP_BRAND]: true,
      [OP_BOUND_BRAND]: bound,
      _tag: "Op" as const,
    }),
  );

  if (iterable !== undefined) {
    Object.assign(self, {
      [Symbol.iterator]: () => iterable().iterate(),
    });
  }

  return self;
}
