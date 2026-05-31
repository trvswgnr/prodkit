import { Result } from "../../result.js";
import { OP_BOUND_BRAND, OP_BRAND, unsafeCoerce } from "../../shared.js";
import { createRunContext } from "../runtime.js";
import { SuspendInstruction } from "../instructions.js";
import type { UnhandledException } from "../../errors.js";
import type { Op } from "../../index.js";
import type { OpPolicy, OpPolicyInput, OpPolicySource, OpPolicyType } from "../../policy/types.js";
import type {
  AnyNullaryOp,
  AsArgs,
  EmptyMeta,
  EnterFn,
  ExitFn,
  OpInterface,
  OpLifecycleHook,
  RunContext,
  TrackedErr,
} from "../types.js";
import {
  OP_PLAN_BIND,
  createPlan,
  genPlan,
  type Plan,
  type PlanBackedOp,
  type PlanBinder,
  type PlanRewriter,
} from "./base.js";
import { onEnterPlan, onExitPlan } from "./lifecycle.js";
import {
  flatMapPlan,
  mapErrPlan,
  mapPlan,
  recoverPlan,
  tapErrPlan,
  tapPlan,
} from "./transforms.js";

type PlanShellContext<T, E, A, M> = {
  bindArgs: PlanBinder<T, E, A, M>;
  withPolicyIterable: <TNext, ENext, MNext>(
    transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
  ) => (() => Plan<TNext, ENext, MNext>) | undefined;
  bound: boolean;
};

function wrapPlanTransform<T, E, A, M, Yieldable extends boolean, TNext, ENext, MNext>(
  ctx: PlanShellContext<T, E, A, M>,
  transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
): OpInterface<TNext, ENext, A, MNext, Yieldable> {
  return makePlanOp<TNext, ENext, A, MNext, Yieldable>(
    (...args) => transform(ctx.bindArgs(...args)),
    ctx.withPolicyIterable(transform),
    ctx.bound,
  );
}

function fluentMethodsForContext<T, E, A, M, Yieldable extends boolean>(
  ctx: PlanShellContext<T, E, A, M>,
) {
  const wrap = <TNext, ENext, MNext>(
    transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
  ) => wrapPlanTransform<T, E, A, M, Yieldable, TNext, ENext, MNext>(ctx, transform);

  return {
    with: <F extends OpPolicyType>(policy: OpPolicy<OpPolicyInput<T, E, AsArgs<A>, M>, F>) => {
      const source: OpPolicySource<T, E, AsArgs<A>, M> = {
        wrap: <TNext, ENext, MNext>(
          transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
        ) =>
          // SAFETY: wrapPlanTransform returns the same branded Op runtime shell; this narrows the
          // public type to the policy source arity already supplied by the enclosing FluentOp.
          unsafeCoerce<Op<TNext, ENext, AsArgs<A>, MNext>>(wrap(transform)),
        rewrite: <TNext, ENext, MNext>(rewriter: PlanRewriter) =>
          // SAFETY: Plan.rewrite returns a branded plan with the policy layer's selected type
          // target; wrapPlanTransform preserves the enclosing Op arity.
          unsafeCoerce<Op<TNext, ENext, AsArgs<A>, MNext>>(
            wrap((plan) => plan.rewrite<TNext, ENext, MNext>(rewriter)),
          ),
        around: <TNext, ENext, MNext = M>(
          run: (
            next: (
              context: RunContext<readonly unknown[]>,
            ) => Promise<Result<T, E | UnhandledException>>,
            context: RunContext<readonly unknown[]>,
          ) => PromiseLike<Result<TNext, ENext | UnhandledException>>,
        ) =>
          // SAFETY: the generated plan preserves the enclosing policy source arity and returns
          // the typed Result supplied by the policy around hook.
          unsafeCoerce<Op<TNext, ENext, AsArgs<A>, MNext>>(
            wrap((plan) =>
              createPlan<TNext, ENext, MNext>(function* () {
                const result: Result<TNext, ENext | UnhandledException> =
                  yield* new SuspendInstruction((context) =>
                    run((nextContext) => plan.execute(nextContext), context),
                  );

                if (result.isErr()) return yield* result;
                return result.value;
              }),
            ),
          ),
      };

      return policy.apply(source);
    },
    on: (event: OpLifecycleHook, handler: unknown) => {
      if (event === "enter") {
        const initialize = handler as EnterFn<A>;
        return wrap((plan) => onEnterPlan(plan, initialize));
      }

      if (event === "exit") {
        const finalize = handler as ExitFn<T, E, A>;
        return wrap((plan) => onExitPlan(plan, finalize));
      }

      throw new Error(`Invalid event: ${event}`);
    },
    map: <U>(transform: (value: T) => U) => wrap((plan) => mapPlan(plan, transform)),
    mapErr: <E2>(transform: (error: TrackedErr<E>) => E2) =>
      wrap((plan) => mapErrPlan(plan, transform)),
    flatMap: <R extends AnyNullaryOp>(bind: (value: T) => R) =>
      wrap((plan) => flatMapPlan(plan, bind)),
    tap: <R>(observe: (value: T) => R) => wrap((plan) => tapPlan(plan, observe)),
    tapErr: <R>(observe: (error: TrackedErr<E>) => R) => wrap((plan) => tapErrPlan(plan, observe)),
    recover: <ECaught extends TrackedErr<E>, R>(
      predicate: (error: TrackedErr<E>) => error is ECaught,
      handler: (error: ECaught) => R,
    ) => wrap((plan) => recoverPlan(plan, predicate, handler)),
  };
}

function syncValueShellContext<T>(
  self: SyncValueOpShell<T>,
): PlanShellContext<T, never, [], EmptyMeta> {
  return {
    bindArgs: () => self[OP_PLAN_BIND](),
    withPolicyIterable: (transform) => () => transform(self[OP_PLAN_BIND]()),
    bound: true,
  };
}

function createSyncValueFluentPrototype(): PropertyDescriptorMap {
  type FluentMethod = keyof ReturnType<
    typeof fluentMethodsForContext<unknown, never, [], EmptyMeta, true>
  >;

  const bindMethod = <K extends FluentMethod>(name: K): PropertyDescriptor => ({
    value(this: SyncValueOpShell<unknown>, ...args: unknown[]) {
      const methods = fluentMethodsForContext<unknown, never, [], EmptyMeta, true>(
        syncValueShellContext(this),
      );
      const method = methods[name] as (...methodArgs: unknown[]) => unknown;
      return method(...args);
    },
  });

  const methodNames = [
    "with",
    "on",
    "map",
    "mapErr",
    "flatMap",
    "tap",
    "tapErr",
    "recover",
  ] as const satisfies readonly FluentMethod[];

  return Object.fromEntries(methodNames.map((name) => [name, bindMethod(name)]));
}

export function makePlanOp<
  T,
  E,
  A,
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
    : (...args: AsArgs<A>) =>
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
            ...unsafeCoerce<AsArgs<A>>([]),
          )
      : undefined);

  const withPolicyIterable = <TNext, ENext, MNext>(
    transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
  ) => (iterable === undefined ? undefined : () => transform(iterable()));

  const shellContext: PlanShellContext<T, E, A, M> = {
    bindArgs,
    withPolicyIterable,
    bound,
  };

  // SAFETY: Object.assign decorates the runtime callable with the Op method surface and
  // internal plan binder. The callable and method signatures are supplied by the generic inputs.
  self = unsafeCoerce(
    Object.assign(invoke, {
      [OP_PLAN_BIND]: bindArgs,
      run: (...args: AsArgs<A>) =>
        bindArgs(...args).execute(createRunContext(new AbortController().signal, args)),
      ...fluentMethodsForContext<T, E, A, M, Yieldable>(shellContext),
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

  return self;
}
