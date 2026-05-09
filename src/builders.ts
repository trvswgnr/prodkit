import { UnhandledException } from "./errors.js";
import { makeFluentArityOp, onOp } from "./core/arity-ops.js";
import { TrackedErr, type AnyExitFn, type Instruction, type OpArity } from "./core/types.js";
import type { Op } from "./index.js";
import { RegisterExitFinalizerInstruction, SuspendInstruction } from "./core/instructions.js";
import { withRetryOp, withTimeoutOp, withSignalOp } from "./policies.js";
import { Result, type InferErr } from "./result.js";
import {
  makeNullaryOp,
  createDefaultHooks,
  isNullaryOp,
  isOp,
  withCleanupNullaryOp,
} from "./core/nullary-ops.js";
import { cast } from "./shared.js";
import { drive } from "./core/runtime.js";

function isAwaited<T>(value: T | Promise<T>): value is Awaited<T> {
  return !(value instanceof Promise);
}

function isGeneratorObject(
  value: unknown,
): value is Generator<Instruction<unknown>, unknown, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (!("next" in value) || typeof value.next !== "function") return false;
  if (!("throw" in value) || typeof value.throw !== "function") return false;
  if (!(Symbol.iterator in value) || typeof value[Symbol.iterator] !== "function") return false;
  return true;
}

function coerceMapperToNullaryOp(value: unknown): Op<unknown, unknown, []> | undefined {
  if (isNullaryOp(value)) return value;

  if (isOp(value)) {
    return cast(value());
  }

  if (!isGeneratorObject(value)) return undefined;

  let generatorOp: Op<unknown, unknown, []>;
  generatorOp = makeNullaryOp(
    () => cast(value),
    createDefaultHooks(() => generatorOp),
  );
  return generatorOp;
}

/**
 * Lifts a value into an operation that always completes successfully
 */
export function succeed<T>(value: T | Promise<T>): Op<Awaited<T>, never, []> {
  if (!isAwaited(value)) {
    return _try(() => value);
  }

  const op: Op<Awaited<T>, never, []> = makeNullaryOp(
    function* () {
      return value;
    },
    createDefaultHooks(() => op),
  );

  return op;
}

/**
 * Lifts a value into an operation that always fails
 */
export function fail<E>(value: E): Op<never, E, []> {
  const op: Op<never, E, []> = makeNullaryOp(
    function* () {
      return yield* Result.err(value);
    },
    createDefaultHooks(() => op),
  );

  return op;
}

/**
 * Registers deferred cleanup for the current op run. Use as `yield* Op.defer((ctx) => ...)`
 * If several callbacks throw during the same unwind, `run` fails with {@link UnhandledException}
 * whose `cause` is a nested {@link Error} chain (`.cause`), **first LIFO failure outermost**
 */
export function defer(finalize: AnyExitFn): Op<void, never, []> {
  const op: Op<void, never, []> = makeNullaryOp(
    function* () {
      yield new RegisterExitFinalizerInstruction((ctx) =>
        Promise.resolve(finalize(ctx)).then(() => {}),
      );
    },
    createDefaultHooks(() => op),
  );
  return op;
}

/**
 * Suspends until a promise settles, then continues with its value or a mapped failure
 *
 * `onError` may return a value, promise, nullary `Op`, or generator object. Program-shaped
 * mappers are driven and their return value is used as the mapped typed error.
 */
export function _try<T, E = UnhandledException>(
  f: (signal: AbortSignal) => T,
  onError?: (
    e: unknown,
  ) => E | Promise<E> | Op<E, unknown, []> | Generator<Instruction<unknown>, E, unknown>,
): Op<Awaited<T>, TrackedErr<Awaited<E>>, []> {
  const op: Op<Awaited<T>, TrackedErr<Awaited<E>>, []> = makeNullaryOp(
    function* () {
      const result: Result<T, Awaited<E> | UnhandledException> = yield* new SuspendInstruction(
        (signal: AbortSignal) =>
          Promise.resolve()
            .then(() => f(signal))
            .then(
              (a) => Result.ok(a),
              async (cause) => {
                if (!onError) return Result.err(new UnhandledException({ cause }));
                const mappedOrProgram = await onError(cause);
                const mappedProgram = coerceMapperToNullaryOp(mappedOrProgram);
                if (!mappedProgram) return Result.err(mappedOrProgram as Awaited<E>);

                const mappedResult = await drive(mappedProgram, signal);
                if (mappedResult.isErr()) throw mappedResult.error;
                return Result.err(mappedResult.value as Awaited<E>);
              },
            ),
      );

      if (result.isErr()) return yield* result;
      return result.value as Awaited<T>;
    },
    createDefaultHooks(() => op),
  );
  return op;
}

function makeArityOp<T, E, A extends readonly unknown[]>(
  invoke: (...args: A) => Op<T, E, []>,
): OpArity<T, E, A> {
  return makeFluentArityOp(invoke, (self) => ({
    withRetry: (policy) => makeArityOp((...args) => withRetryOp(invoke(...args), policy)),
    withTimeout: (timeoutMs) => makeArityOp((...args) => withTimeoutOp(invoke(...args), timeoutMs)),
    withSignal: (signal) => makeArityOp((...args) => withSignalOp(invoke(...args), signal)),
    withRelease: (release) =>
      makeArityOp((...args) => withCleanupNullaryOp(invoke(...args), release)),
    on: (event, handler) => onOp(self, event, handler),
  }));
}

/**
 * Turns a generator function into an {@link Op}
 */
export function fromGenFn<Y extends Instruction<unknown>, T, A extends readonly unknown[]>(
  f: (...args: A) => Generator<Y, T, unknown>,
): Op<T, InferErr<Y>, A> {
  // we are intentionally always returning the arity wrapper shape, including for `A = []` generators
  // this keeps arity/nullary classification deterministic via explicit op kind metadata
  // instead of runtime function reflection or shape guessing in correctness paths
  const op = makeArityOp((...args: A) => {
    // TS cannot model `Generator<Y, T, unknown>` as the internal instruction-supertype without this bridge cast
    const bound: Op<T, InferErr<Y>, []> = makeNullaryOp(
      () => cast<never>(f(...args)),
      createDefaultHooks(() => bound),
    );
    return bound;
  });
  // SAFETY: `makeArityOp` returns an OpArity<T, E, A>, so we need to cast it to an Op<T, E, A>
  return cast(op);
}
