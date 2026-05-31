export const HKT_ARGS = Symbol("prodkit.hkt.args");
export const HKT_RESULT = Symbol("prodkit.hkt.result");

interface HKTApplication<Args> {
  readonly [HKT_ARGS]: Args;
}

export interface HKT {
  readonly [HKT_ARGS]: unknown;
  readonly [HKT_RESULT]: unknown;
}

export type HKTArg<Self, Index extends PropertyKey> =
  Self extends HKTApplication<infer AppliedArgs>
    ? Index extends keyof AppliedArgs
      ? AppliedArgs[Index]
      : never
    : never;

export type Apply<F extends HKT, Args> = (F & HKTApplication<Args>)[typeof HKT_RESULT];
