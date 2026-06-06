import { getPlan, createUnaryPlan, type Plan } from "../core/plan/base.js";
import type { AsArgs } from "../core/plan/surface.js";
import { makeUnboundPlanOp } from "../core/plan/shell.js";
import { Settlement, SettlementPresets } from "../core/settlement-scope.js";
import { CUSTOM_INSTRUCTION_META, type CustomInstruction } from "../core/instructions.js";
import type { RunContext } from "../core/runtime.js";
import { UnhandledException } from "../errors.js";
import { Result } from "../result.js";
import { abortReason, NEVER, isPromiseLike, unsafeCoerce } from "@prodkit/shared/runtime";
import type { EmptyMeta } from "../core/meta.js";
import type { Op } from "../index.js";
import {
  MISSING_DEPENDENCY,
  extendContextWithBindings,
  readEnv,
  resolveInjectedValue,
} from "./env.js";
import {
  MissingDependencyError,
  type AnyBinding,
  type AnyDependency,
  type ProvidedMeta,
  type WithDIMeta,
} from "./types.js";

export class InjectInstruction<T, D> implements CustomInstruction<T, WithDIMeta<EmptyMeta, D>> {
  readonly _tag = "InjectInstruction";
  readonly [CUSTOM_INSTRUCTION_META]: WithDIMeta<EmptyMeta, D> = NEVER;
  readonly dependency: AnyDependency;

  constructor(dependency: AnyDependency) {
    this.dependency = dependency;
  }

  resolve(context: RunContext<readonly unknown[]>): T | PromiseLike<T> {
    if (context.signal.aborted) {
      throw abortReason(context.signal);
    }

    const env = readEnv(context);
    const value = resolveInjectedValue(env, this.dependency, context.signal);

    if (value === MISSING_DEPENDENCY) {
      throw new MissingDependencyError(this.dependency.key);
    }

    if (isPromiseLike(value)) {
      return value.then((resolved) =>
        // SAFETY: env slots are unknown at runtime; InjectInstruction<T> and resolution guarantee the value is T.
        unsafeCoerce(resolved),
      );
    }

    // SAFETY: env slots are unknown at runtime; InjectInstruction<T> and resolution guarantee the value is T.
    return unsafeCoerce(value);
  }

  *[Symbol.iterator](): Generator<this, T, unknown> {
    // SAFETY: generator yield type is unknown; CustomInstruction resolves yield* to the same T as resolve().
    return unsafeCoerce(yield this);
  }

  static is(value: unknown): value is InjectInstruction<unknown, AnyDependency> {
    return value instanceof InjectInstruction;
  }
}

export function providePlan<T, E, M>(
  source: Plan<T, E, M>,
  bindings: readonly AnyBinding[],
): Plan<T, E, M> {
  const snapshot = bindings.slice();

  return createUnaryPlan(
    function* () {
      const result: Result<T, E | UnhandledException> = yield* Settlement.suspendPlan(
        SettlementPresets.interruptingAndDraining,
        source,
        (context) => extendContextWithBindings(context, snapshot),
      );

      if (result.isErr()) return yield* result;
      return result.value;
    },
    source,
    (inner) => providePlan(inner, snapshot),
  );
}

export function provideOp<T, E, A, M, const Bindings extends readonly AnyBinding[]>(
  op: Op<T, E, A, M>,
  bindings: Bindings,
): Op<T, E, A, ProvidedMeta<M, Bindings>> {
  const bindProvidePlan = (...args: AsArgs<A>) => providePlan(getPlan(op, args), bindings);

  // SAFETY: makeUnboundPlanOp cannot express ProvidedMeta; bindings only change metadata, not T, E, or runtime behavior.
  return unsafeCoerce(
    makeUnboundPlanOp(bindProvidePlan, () =>
      bindProvidePlan(
        // SAFETY: yield* iterable is nullary (A=[]); bindProvidePlan expects no runtime args on this surface.
        ...unsafeCoerce<AsArgs<A>>([]),
      ),
    ),
  );
}
