import type { AnyNullaryOp, InferOpMeta, InferOpOk, InferOpErr } from "./core/plan/surface.js";
import type { Op } from "./index.js";
import { allPlan, allSettledPlan, anyPlan, racePlan } from "./core/plan/combinators.js";
import { getPlan } from "./core/plan/base.js";
import { makePlanOp } from "./core/plan/shell.js";
import { makeCoreOp } from "./core/fluent.js";
import { SuspendInstruction, SuspendResume } from "./core/instructions.js";
import { drive } from "./core/runtime.js";
import { Result } from "./result.js";
import type { EmptyMeta, MergeMeta } from "./core/meta.js";
import { unsafeCoerce } from "@prodkit/shared/runtime";
import { EMPTY_TUPLE } from "./shared.js";
import type { Instruction } from "./core/instructions.js";
import { ErrorGroup, UnhandledException } from "./errors.js";

type MergeOpsMeta<Ops extends readonly AnyNullaryOp[]> = Ops extends readonly [
  infer Head extends AnyNullaryOp,
  ...infer Tail extends readonly AnyNullaryOp[],
]
  ? MergeMeta<InferOpMeta<Head>, MergeOpsMeta<Tail>>
  : EmptyMeta;

function makeCombinatorOp<T, E, M = EmptyMeta>(
  gen: () => Generator<Instruction<E>, T, unknown>,
): Op<T, E, [], M> {
  return makeCoreOp<T, E, M>(
    // SAFETY: combinator generators yield runtime instructions; M is declared on the returned Op.
    () => unsafeCoerce(gen()),
  );
}

type AllOpOk<Ops extends readonly AnyNullaryOp[]> = { [K in keyof Ops]: InferOpOk<Ops[K]> };
type AllOpErr<Ops extends readonly AnyNullaryOp[]> = InferOpErr<Ops[number]>;

export function allOp<const Ops extends readonly AnyNullaryOp[]>(
  ops: Ops,
  concurrency?: number,
): Op<AllOpOk<Ops>, AllOpErr<Ops>, [], MergeOpsMeta<Ops>> {
  const snapshot = ops.slice();
  const bindAllPlan = () =>
    allPlan(
      snapshot.map((op) => getPlan(op, EMPTY_TUPLE)),
      concurrency,
    );

  // SAFETY: plan-backed binder preserves combinator tuple inference from snapshot ops.
  return unsafeCoerce(makePlanOp(bindAllPlan, bindAllPlan, true));
}

type AllSettledOpOk<Ops extends readonly AnyNullaryOp[]> = {
  [K in keyof Ops]: Result<InferOpOk<Ops[K]>, InferOpErr<Ops[K]> | UnhandledException>;
};
export function allSettledOp<const Ops extends readonly AnyNullaryOp[]>(
  ops: Ops,
  concurrency?: number,
): Op<AllSettledOpOk<Ops>, never, [], MergeOpsMeta<Ops>> {
  const snapshot = ops.slice();
  const bindAllSettledPlan = () =>
    allSettledPlan(
      snapshot.map((op) => getPlan(op, EMPTY_TUPLE)),
      concurrency,
    );

  // SAFETY: plan-backed binder preserves combinator tuple inference from snapshot ops.
  return unsafeCoerce(makePlanOp(bindAllSettledPlan, bindAllSettledPlan, true));
}

export function settleOp<T, E, M>(
  op: Op<T, E, [], M>,
): Op<Result<T, E | UnhandledException>, never, [], M> {
  return makeCombinatorOp(function* () {
    return yield* new SuspendInstruction(
      (outerContext) => drive(op, outerContext),
      SuspendResume.passThrough,
    );
  });
}

/**
 * helper to check if any op in the list has an infallible error type
 */
type HasInfallibleOp<Ops extends readonly AnyNullaryOp[]> = Ops extends readonly [
  infer Head extends AnyNullaryOp,
  ...infer Tail extends readonly AnyNullaryOp[],
]
  ? [InferOpErr<Head>] extends [never]
    ? true
    : HasInfallibleOp<Tail>
  : false;

type AnyOpOk<Ops extends readonly AnyNullaryOp[]> = InferOpOk<Ops[number]>;
type AnyOpErr<Ops extends readonly AnyNullaryOp[]> =
  HasInfallibleOp<Ops> extends true ? never : ErrorGroup<InferOpErr<Ops[number]>>;

export function anyOp<const Ops extends readonly AnyNullaryOp[]>(
  ops: Ops,
): Op<AnyOpOk<Ops>, AnyOpErr<Ops>, [], MergeOpsMeta<Ops>> {
  const snapshot = ops.slice();
  const bindAnyPlan = () => anyPlan(snapshot.map((op) => getPlan(op, EMPTY_TUPLE)));

  // SAFETY: plan-backed binder preserves combinator tuple inference from snapshot ops.
  return unsafeCoerce(makePlanOp(bindAnyPlan, bindAnyPlan, true));
}

type RaceOpOk<Ops extends readonly AnyNullaryOp[]> = InferOpOk<Ops[number]>;
type RaceOpErr<Ops extends readonly AnyNullaryOp[]> = InferOpErr<Ops[number]>;
export function raceOp<const Ops extends readonly AnyNullaryOp[]>(
  ops: Ops,
): Op<RaceOpOk<Ops>, RaceOpErr<Ops>, [], MergeOpsMeta<Ops>> {
  const snapshot = ops.slice();
  const bindRacePlan = () => racePlan(snapshot.map((op) => getPlan(op, EMPTY_TUPLE)));

  // SAFETY: plan-backed binder preserves combinator tuple inference from snapshot ops.
  return unsafeCoerce(makePlanOp(bindRacePlan, bindRacePlan, true));
}
