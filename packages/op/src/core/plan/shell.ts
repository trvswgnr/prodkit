import { Result } from "../../result.js";
import { unsafeCoerce } from "@prodkit/shared/runtime";
import { OP_BOUND_BRAND, OP_BRAND } from "../../shared.js";
import { createRunContext } from "../runtime.js";
import { SuspendInstruction, SuspendResume } from "../instructions.js";
import type { UnhandledException } from "../../errors.js";
import type { Op } from "../../index.js";
import type { OpPolicy, OpPolicyInput, OpPolicySource } from "../../policy/types.js";
import type { HKT } from "../../hkt.js";
import type { EnterFn, ExitFn, OpLifecycleHook } from "./context.js";
import type { AnyNullaryOp, AsArgs, OpInterface, TrackedErr } from "./surface.js";
import type { RunContext } from "../runtime.js";
import type { EmptyMeta } from "../meta.js";
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
  makeIterable: (() => Plan<T, E, M>) | undefined;
  bound: boolean;
};

type ErasedPlan = Plan<unknown, unknown, unknown>;
type ErasedPlanFactory = (...args: readonly unknown[]) => ErasedPlan;
type ErasedPlanTransform = (plan: ErasedPlan) => ErasedPlan;
const PLAN_FACTORY_CHAIN: unique symbol = Symbol("prodkit.op.plan-factory-chain");
type PlanTransformNode = {
  readonly previous: PlanTransformNode | undefined;
  readonly transform: ErasedPlanTransform;
};
type PlanFactoryChain = {
  readonly base: ErasedPlanFactory;
  readonly tail: PlanTransformNode | undefined;
};
type ChainablePlanFactory = ErasedPlanFactory & {
  readonly [PLAN_FACTORY_CHAIN]?: PlanFactoryChain;
};

type PolicyWrapFn = <TNext, ENext, MNext>(
  transform: (plan: Plan<unknown, unknown, unknown>) => Plan<TNext, ENext, MNext>,
) => unknown;

class PolicySourceImpl {
  wrapPlan: PolicyWrapFn;

  constructor(wrapPlan: PolicyWrapFn) {
    this.wrapPlan = wrapPlan;
  }

  wrap<T, E, A, M, TNext, ENext, MNext>(
    transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
  ): Op<TNext, ENext, AsArgs<A>, MNext> {
    // SAFETY: PolicyWrapFn returns unknown; wrapPlanTransform builds an Op shell with TNext, ENext, and A.
    return unsafeCoerce<Op<TNext, ENext, AsArgs<A>, MNext>>(
      this.wrapPlan(
        // SAFETY: PolicyWrapFn erases plan generics; transform closes over the source plan's T, E, M.
        unsafeCoerce(transform),
      ),
    );
  }

  rewrite<A, TNext, ENext, MNext>(rewriter: PlanRewriter): Op<TNext, ENext, AsArgs<A>, MNext> {
    // SAFETY: PolicyWrapFn returns unknown; rewrite already targeted TNext, ENext, MNext on the inner plan.
    return unsafeCoerce<Op<TNext, ENext, AsArgs<A>, MNext>>(
      this.wrapPlan((plan) => plan.rewrite<TNext, ENext, MNext>(rewriter)),
    );
  }

  around<T, E, A, M, TNext, ENext, MNext = M>(
    run: (
      next: (context: RunContext<readonly unknown[]>) => Promise<Result<T, E | UnhandledException>>,
      context: RunContext<readonly unknown[]>,
    ) => PromiseLike<Result<TNext, ENext | UnhandledException>>,
  ): Op<TNext, ENext, AsArgs<A>, MNext> {
    // SAFETY: PolicyWrapFn returns unknown; around() middleware was typed against the source plan's T, E, M.
    return unsafeCoerce<Op<TNext, ENext, AsArgs<A>, MNext>>(
      this.wrapPlan((plan) => {
        // SAFETY: PolicyWrapFn erases plan to unknown; around() closes over T, E, M and only calls typedPlan.execute.
        const typedPlan: Plan<T, E, M> = unsafeCoerce(plan);
        return createPlan<TNext, ENext, MNext>(function* () {
          const result: Result<TNext, ENext | UnhandledException> = yield* new SuspendInstruction(
            (context) => run((nextContext) => typedPlan.execute(nextContext), context),
            SuspendResume.passThrough,
          );

          if (result.isErr()) return yield* result;
          return result.value;
        });
      }),
    );
  }
}

function wrapPlanTransform<T, E, A, M, Yieldable extends boolean, TNext, ENext, MNext>(
  ctx: PlanShellContext<T, E, A, M>,
  transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
): OpInterface<TNext, ENext, A, MNext, Yieldable> {
  const bindArgs = appendPlanBinder(ctx.bindArgs, transform);
  const makeIterable =
    ctx.makeIterable === undefined ? undefined : appendPlanProvider(ctx.makeIterable, transform);

  return makePlanOp<TNext, ENext, A, MNext, Yieldable>(bindArgs, makeIterable, ctx.bound);
}

function appendPlanBinder<T, E, A, M, TNext, ENext, MNext>(
  bindArgs: PlanBinder<T, E, A, M>,
  transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
): PlanBinder<TNext, ENext, A, MNext> {
  // SAFETY: transform chains erase plan generics until bind time, then restore the typed binder surface.
  const erasedBindArgs: ErasedPlanFactory = unsafeCoerce(bindArgs);
  // SAFETY: transform closes over the source plan generics; the erased chain preserves transform order only.
  const erasedTransform: ErasedPlanTransform = unsafeCoerce(transform);
  const appended = appendPlanTransform(erasedBindArgs, erasedTransform);
  // SAFETY: appended binder keeps the original args tuple and returns the transform's next plan type.
  return unsafeCoerce(appended);
}

function appendPlanProvider<T, E, M, TNext, ENext, MNext>(
  provider: () => Plan<T, E, M>,
  transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
): () => Plan<TNext, ENext, MNext> {
  // SAFETY: iterable providers are nullary plan factories; only plan generics are erased in the chain.
  const erasedProvider: ErasedPlanFactory = unsafeCoerce(provider);
  // SAFETY: transform closes over the source plan generics; the erased chain preserves transform order only.
  const erasedTransform: ErasedPlanTransform = unsafeCoerce(transform);
  const appended = appendPlanTransform(erasedProvider, erasedTransform);
  // SAFETY: appended provider returns the transform's next plan type.
  return unsafeCoerce(appended);
}

function appendPlanTransform(
  factory: ErasedPlanFactory,
  transform: ErasedPlanTransform,
): ErasedPlanFactory {
  const chain = getPlanFactoryChain(factory);
  const tail: PlanTransformNode = { previous: chain.tail, transform };
  const next: ErasedPlanFactory = (...args) => applyPlanTransforms(chain.base(...args), tail);
  Object.defineProperty(next, PLAN_FACTORY_CHAIN, {
    value: { base: chain.base, tail } satisfies PlanFactoryChain,
  });
  return next;
}

function getPlanFactoryChain(factory: ErasedPlanFactory): PlanFactoryChain {
  const chainable: ChainablePlanFactory = factory;
  return chainable[PLAN_FACTORY_CHAIN] ?? { base: factory, tail: undefined };
}

function applyPlanTransforms(source: ErasedPlan, tail: PlanTransformNode): ErasedPlan {
  const transforms: ErasedPlanTransform[] = [];
  for (let node: PlanTransformNode | undefined = tail; node !== undefined; node = node.previous) {
    transforms.push(node.transform);
  }

  let plan = source;
  for (let index = transforms.length - 1; index >= 0; index -= 1) {
    const transform = transforms[index];
    if (transform !== undefined) plan = transform(plan);
  }
  return plan;
}

function fluentMethodsForContext<T, E, A, M, Yieldable extends boolean>(
  ctx: PlanShellContext<T, E, A, M>,
) {
  const wrap = <TNext, ENext, MNext>(
    transform: (plan: Plan<T, E, M>) => Plan<TNext, ENext, MNext>,
  ) => wrapPlanTransform<T, E, A, M, Yieldable, TNext, ENext, MNext>(ctx, transform);

  // SAFETY: PolicySourceImpl is structural but unbranded; methods delegate through wrap with the same generics.
  const policySource: OpPolicySource<T, E, AsArgs<A>, M> = unsafeCoerce(new PolicySourceImpl(wrap));

  return {
    with: <F extends HKT>(policy: OpPolicy<OpPolicyInput<T, E, AsArgs<A>, M>, F>) =>
      policy.apply(policySource),
    on: (event: OpLifecycleHook, handler: unknown) => {
      if (event === "enter") {
        // SAFETY: on() types handler as unknown; the enter branch only runs when event === "enter".
        const initialize: EnterFn<A> = unsafeCoerce(handler);
        return wrap((plan) => onEnterPlan(plan, initialize));
      }

      if (event === "exit") {
        // SAFETY: on() types handler as unknown; the exit branch only runs when event === "exit".
        const finalize: ExitFn<T, E, A> = unsafeCoerce(handler);
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
    makeIterable: () => self[OP_PLAN_BIND](),
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

      // SAFETY: prototype dispatch erases generics; name is a FluentMethod key from the same methods table.
      const method: (...methodArgs: unknown[]) => unknown = unsafeCoerce(methods[name]);
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
            // SAFETY: iterable branch is bound and nullary; invoke already fixed args so the binder expects [].
            ...unsafeCoerce<AsArgs<A>>([]),
          )
      : undefined);

  const shellContext: PlanShellContext<T, E, A, M> = {
    bindArgs,
    makeIterable: iterable,
    bound,
  };

  // SAFETY: Object.assign builds a callable Object without Op branding; invoke/run/methods match generic inputs.
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

const SYNC_VALUE_OP_PROTOTYPE: SyncValueOpShell<unknown> = Object.create(
  null,
  createSyncValueFluentPrototype(),
);

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

  const invoke = () => self;
  let self: SyncValueOpShell<T>;

  // SAFETY: Object.assign builds the same shell shape as makePlanOp; sync values skip generator drive only.
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
