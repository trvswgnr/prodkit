import { UnhandledException } from "./errors.js";
import { makeUnboundPlanOp, makeSyncValueOp } from "./core/plan/shell.js";
import { genPlan } from "./core/plan/base.js";
import type { AnyExitFn } from "./core/plan/context.js";
import type { AsArgs, OpInterface, TrackedErr } from "./core/plan/surface.js";
import type {
  InferInstructionErr,
  InferInstructionMeta,
  Instruction,
} from "./core/instructions.js";
import type { EmptyMeta } from "./core/meta.js";
import type { Op } from "./index.js";
import { RegisterExitFinalizerInstruction, SuspendInstruction } from "./core/instructions.js";
import { Result } from "./result.js";
import { makeCoreOp } from "./core/fluent.js";
import { isAwaited, sleepWithSignal, unsafeCoerce } from "@prodkit/shared/runtime";

export function succeed<T>(value: T | PromiseLike<T>): Op<Awaited<T>, never, [], EmptyMeta> {
  if (!isAwaited(value)) {
    return _try(() => value);
  }

  return makeSyncValueOp(value);
}

/*
 * Lifts a value into an operation that always fails
 */
export function fail<E>(value: E): Op<never, E, [], EmptyMeta> {
  return makeCoreOp(function* () {
    return yield* Result.err(value);
  });
}

export function defer(finalize: AnyExitFn): Op<void, never, [], EmptyMeta> {
  return makeCoreOp(function* () {
    yield new RegisterExitFinalizerInstruction(
      (ctx) => Promise.resolve(finalize(ctx)).then(() => {}),
      undefined,
    );
  });
}

export function sleep(ms: number): Op<void, never, [], EmptyMeta> {
  return _try((signal) => sleepWithSignal(ms, signal));
}

/*
 * Suspends until a promise settles, then continues with its value or a mapped failure
 *
 * `onError` may return a value or promise. Program-shaped values are used as the mapped typed
 * error value and are not driven.
 */
export function _try<T, E = UnhandledException>(
  f: (signal: AbortSignal) => T,
  onError?: (e: unknown) => E | PromiseLike<E>,
): Op<Awaited<T>, TrackedErr<Awaited<E>>, [], EmptyMeta> {
  return makeCoreOp(function* () {
    const result: Result<
      Awaited<T>,
      Awaited<E> | UnhandledException
    > = yield* new SuspendInstruction(async (context) =>
      Promise.resolve()
        .then(() => f(context.signal))
        .then(
          (a) => Result.ok(a),
          async (cause) => {
            if (!onError) return Result.err(new UnhandledException({ cause }));
            const mapped = await onError(cause);
            return Result.err(mapped);
          },
        ),
    );

    if (result.isErr()) return yield* result;
    return result.value;
  });
}

function bindArityArgsToFinalizers<T, M>(
  iterator: Generator<Instruction<unknown, M>, T, unknown>,
  args: readonly unknown[],
): Generator<Instruction<unknown, M>, T, unknown> {
  const bindStep = (
    step: IteratorResult<Instruction<unknown, M>, T>,
  ): IteratorResult<Instruction<unknown, M>, T> => {
    if (step.done) return step;
    if (!(step.value instanceof RegisterExitFinalizerInstruction)) return step;
    if (step.value.args !== undefined) return step;
    return {
      done: false,
      value: new RegisterExitFinalizerInstruction(step.value.finalize, args),
    };
  };

  return {
    next: (value?: unknown) => bindStep(iterator.next(value)),
    return: (value: T) => bindStep(iterator.return(value)),
    throw: (error?: unknown) => bindStep(iterator.throw(error)),
    [Symbol.iterator]() {
      return this;
    },
  };
}

/**
 * Turns a generator function into an {@link Op}
 */
export function fromGenFn<Y extends Instruction<unknown, unknown>, T, A>(
  f: (...args: AsArgs<A>) => Generator<Y, T, unknown>,
): Op<T, InferInstructionErr<Y>, A, InferInstructionMeta<Y>> {
  // We intentionally always build through the tuple-arity lifting path, including for `A = []`.
  // This keeps runtime behavior uniform while preserving exact tuple signatures at the type level.
  const bindPlan = (...args: AsArgs<A>) =>
    genPlan(() =>
      // SAFETY: user generators use instruction subtype Y; runtime iterator is the internal Instruction supertype.
      unsafeCoerce<
        Generator<Instruction<InferInstructionErr<Y>, InferInstructionMeta<Y>>, T, unknown>
      >(bindArityArgsToFinalizers(f(...args), args)),
    );

  const op: OpInterface<T, InferInstructionErr<Y>, A, InferInstructionMeta<Y>> = makeUnboundPlanOp(
    bindPlan,
    () =>
      bindPlan(
        // SAFETY: yield* iterable is nullary (A=[]); bindPlan([]) matches AsArgs<A> for that branch.
        ...unsafeCoerce<AsArgs<A>>([]),
      ),
  );

  return op;
}
