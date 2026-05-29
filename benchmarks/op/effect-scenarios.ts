import { Duration, Effect, Schedule } from "effect";
import {
  COMPOSE_STEPS,
  CONCURRENCY_CHILDREN,
  RETRY_ATTEMPTS,
  TIMEOUT_BUDGET_MS,
} from "./scenarios.ts";

function raceFirstAll(
  effects: readonly Effect.Effect<number, never, never>[],
): Effect.Effect<number, never, never> {
  const [first, ...rest] = effects;
  if (first === undefined) {
    throw new Error("raceFirstAll requires at least one effect");
  }
  return rest.reduce((left, right) => Effect.raceFirst(left, right), first);
}

function succeedChildren(): Effect.Effect<number, never, never>[] {
  return Array.from({ length: CONCURRENCY_CHILDREN }, (_, index) => Effect.succeed(index));
}

export async function runEffectSingleValue(): Promise<void> {
  await Effect.runPromise(Effect.succeed(69));
}

export async function runEffectAll(): Promise<void> {
  await Effect.runPromise(Effect.all(succeedChildren(), { concurrency: "unbounded" }));
}

export async function runEffectFirstSuccess(): Promise<void> {
  await Effect.runPromise(Effect.firstSuccessOf(succeedChildren()));
}

export async function runEffectRaceFirst(): Promise<void> {
  await Effect.runPromise(raceFirstAll(succeedChildren()));
}

export async function runEffectRetry(): Promise<void> {
  let attempt = 0;
  const program = Effect.suspend(() => {
    attempt += 1;
    if (attempt < RETRY_ATTEMPTS) {
      return Effect.fail(new Error("retry"));
    }
    return Effect.succeed(1);
  }).pipe(
    Effect.retry({
      times: RETRY_ATTEMPTS - 1,
      schedule: Schedule.spaced(Duration.zero),
    }),
  );
  await Effect.runPromise(program);
}

export async function runEffectTimeout(): Promise<void> {
  await Effect.runPromise(Effect.succeed(7).pipe(Effect.timeout(TIMEOUT_BUDGET_MS)));
}

export async function runEffectYieldChain(steps: number = COMPOSE_STEPS): Promise<number> {
  const program = Effect.gen(function* () {
    let value = 1;
    for (let step = 0; step < steps; step += 1) {
      value = yield* Effect.succeed(value + 1);
    }
    return value;
  });
  const result = await Effect.runPromise(program);
  if (result !== steps + 1) {
    throw new Error("runEffectYieldChain failed unexpectedly.");
  }
  return result;
}
