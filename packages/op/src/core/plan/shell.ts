import { TimeoutError } from "../../errors.js";
import { Result } from "../../result.js";
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
import { OP_PLAN_BIND, genPlan, type Plan, type PlanBackedOp, type PlanBinder } from "./base.js";
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

type SyncValueOpShell<T> = (() => SyncValueOpShell<T>) &
  PlanBackedOp<T, never, [], EmptyMeta> &
  OpInterface<T, never, [], EmptyMeta, true>;

function* syncValueIterator<T>(value: T): Generator<never, T, unknown> {
  return value;
}

function toFullPlanOp<T>(self: SyncValueOpShell<T>): OpInterface<T, never, [], EmptyMeta, true> {
  const bindPlan = self[OP_PLAN_BIND];
  return makePlanOp(
    () => bindPlan(),
    () => bindPlan(),
    true,
  );
}

function createSyncValueFluentPrototype(): PropertyDescriptorMap {
  const withPolicyIterable =
    <T>(
      self: SyncValueOpShell<T>,
      transform: (plan: Plan<T, never, EmptyMeta>) => Plan<unknown, unknown, EmptyMeta>,
    ) =>
    () =>
      transform(self[OP_PLAN_BIND]());

  return {
    withRetry: {
      value(this: SyncValueOpShell<unknown>, policy?: RetryPolicy) {
        const retryPolicy = policy ?? DEFAULT_RETRY_POLICY;
        return makePlanOp(
          () => this[OP_PLAN_BIND]().withRetry(retryPolicy),
          withPolicyIterable(this, (plan) => plan.withRetry(retryPolicy)),
          true,
        );
      },
    },
    withTimeout: {
      value(this: SyncValueOpShell<unknown>, timeoutMs: number) {
        return makePlanOp(
          () => this[OP_PLAN_BIND]().withTimeout(timeoutMs),
          withPolicyIterable(this, (plan) => plan.withTimeout(timeoutMs)),
          true,
        );
      },
    },
    withSignal: {
      value(this: SyncValueOpShell<unknown>, signal: AbortSignal) {
        return makePlanOp(
          () => this[OP_PLAN_BIND]().withSignal(signal),
          withPolicyIterable(this, (plan) => plan.withSignal(signal)),
          true,
        );
      },
    },
    withRelease: {
      value(this: SyncValueOpShell<unknown>, release: ReleaseFn<unknown>) {
        return makePlanOp(
          () => withReleasePlan(this[OP_PLAN_BIND](), release),
          withPolicyIterable(this, (plan) => withReleasePlan(plan, release)),
          true,
        );
      },
    },
    on: {
      value(this: SyncValueOpShell<unknown>, event: OpLifecycleHook, handler: unknown) {
        if (event === "enter") {
          const initialize = handler as EnterFn<[]>;
          return makePlanOp(
            () => onEnterPlan(this[OP_PLAN_BIND](), initialize),
            withPolicyIterable(this, (plan) => onEnterPlan(plan, initialize)),
            true,
          );
        }

        if (event === "exit") {
          const finalize = handler as ExitFn<unknown, never, []>;
          return makePlanOp(
            () => onExitPlan(this[OP_PLAN_BIND](), finalize),
            withPolicyIterable(this, (plan) => onExitPlan(plan, finalize)),
            true,
          );
        }

        throw new Error(`Invalid event: ${event}`);
      },
    },
    map: {
      value<U>(this: SyncValueOpShell<unknown>, transform: (value: unknown) => U) {
        return toFullPlanOp(this).map(transform);
      },
    },
    mapErr: {
      value<E2>(this: SyncValueOpShell<unknown>, transform: (error: TrackedErr<never>) => E2) {
        return toFullPlanOp(this).mapErr(transform);
      },
    },
    flatMap: {
      value<R extends AnyNullaryOp>(this: SyncValueOpShell<unknown>, bind: (value: unknown) => R) {
        return toFullPlanOp(this).flatMap(bind);
      },
    },
    tap: {
      value<R>(this: SyncValueOpShell<unknown>, observe: (value: unknown) => R) {
        return toFullPlanOp(this).tap(observe);
      },
    },
    tapErr: {
      value<R>(this: SyncValueOpShell<unknown>, observe: (error: TrackedErr<never>) => R) {
        return toFullPlanOp(this).tapErr(observe);
      },
    },
    recover: {
      value<ECaught extends TrackedErr<never>, R>(
        this: SyncValueOpShell<unknown>,
        predicate: (error: TrackedErr<never>) => error is ECaught,
        handler: (error: ECaught) => R,
      ) {
        return toFullPlanOp(this).recover(predicate, handler);
      },
    },
  };
}

const SYNC_VALUE_OP_PROTOTYPE = Object.create(
  null,
  createSyncValueFluentPrototype(),
) as SyncValueOpShell<unknown>;

/**
 * Builds a bound nullary Op for an already-awaited sync success value.
 *
 * Hot paths (`.run()`, `yield*`) skip `makePlanOp` and the full generator driver.
 * Fluent transforms upgrade through the normal plan shell on demand.
 */
export function makeSyncValueOp<T>(value: T): OpInterface<T, never, [], EmptyMeta, true> {
  const bindPlan = () =>
    genPlan(function* () {
      return value;
    });

  const invoke = (() => self) as SyncValueOpShell<T>;
  let self: SyncValueOpShell<T>;

  // SAFETY: same runtime decoration pattern as makePlanOp; brands are proof-only at the type level.
  self = unsafeCoerce(
    Object.assign(invoke, {
      [OP_PLAN_BIND]: bindPlan,
      run: () => Promise.resolve(Result.ok(value)),
      [Symbol.iterator]: () => syncValueIterator(value),
      [OP_BRAND]: true,
      [OP_BOUND_BRAND]: true,
      _tag: "Op" as const,
    }),
  );
  Object.setPrototypeOf(self, SYNC_VALUE_OP_PROTOTYPE);

  // SAFETY: sync-value shell installs the same runtime brands and method surface as makePlanOp.
  return unsafeCoerce(self);
}
