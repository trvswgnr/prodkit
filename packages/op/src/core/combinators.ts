import type { AnyNullaryOp, InferOpMeta, InferOpOk, InferOpErr } from "./surface.js";
import type { Op } from "../index.js";
import { allPlan, allSettledPlan, anyPlan, racePlan, settlePlan } from "../plan/combinators.js";
import { getPlan } from "../plan/bridge.js";
import { makeBoundPlanOp } from "./shell.js";
import { Result } from "../result.js";
import type { EmptyMeta, MergeMeta } from "./metadata.js";
import { unsafeCoerce } from "@prodkit/shared/runtime";
import { EMPTY_TUPLE } from "./identity.js";
import { ErrorGroup, UnhandledException } from "../errors.js";

type MergeOpsMeta<Ops extends readonly AnyNullaryOp[]> = Ops extends readonly [
  infer Head extends AnyNullaryOp,
  ...infer Tail extends readonly AnyNullaryOp[],
]
  ? MergeMeta<InferOpMeta<Head>, MergeOpsMeta<Tail>>
  : EmptyMeta;

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

  // SAFETY: makeBoundPlanOp omits merged metadata in its return; bindAllPlan was built from the typed snapshot ops.
  return unsafeCoerce(makeBoundPlanOp(bindAllPlan));
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

  // SAFETY: makeBoundPlanOp omits merged metadata in its return; bindAllSettledPlan was built from the typed snapshot ops.
  return unsafeCoerce(makeBoundPlanOp(bindAllSettledPlan));
}

export function settleOp<T, E, M>(
  op: Op<T, E, [], M>,
): Op<Result<T, E | UnhandledException>, never, [], M> {
  const bindSettlePlan = () => settlePlan(getPlan(op, EMPTY_TUPLE));

  // SAFETY: makeBoundPlanOp omits metadata in its return; bindSettlePlan was built from the typed source op.
  return unsafeCoerce(makeBoundPlanOp(bindSettlePlan));
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

  // SAFETY: makeBoundPlanOp omits merged metadata in its return; bindAnyPlan was built from the typed snapshot ops.
  return unsafeCoerce(makeBoundPlanOp(bindAnyPlan));
}

type RaceOpOk<Ops extends readonly AnyNullaryOp[]> = InferOpOk<Ops[number]>;
type RaceOpErr<Ops extends readonly AnyNullaryOp[]> = InferOpErr<Ops[number]>;
export function raceOp<const Ops extends readonly AnyNullaryOp[]>(
  ops: Ops,
): Op<RaceOpOk<Ops>, RaceOpErr<Ops>, [], MergeOpsMeta<Ops>> {
  const snapshot = ops.slice();
  const bindRacePlan = () => racePlan(snapshot.map((op) => getPlan(op, EMPTY_TUPLE)));

  // SAFETY: makeBoundPlanOp omits merged metadata in its return; bindRacePlan was built from the typed snapshot ops.
  return unsafeCoerce(makeBoundPlanOp(bindRacePlan));
}
