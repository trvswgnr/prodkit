import { createRunContext, type RunContext } from "../core/runtime.js";
import { AbortSettlement, awaitWithAbort } from "../core/settlement.js";
import { abortReason, hasBrand, isPromiseLike } from "@prodkit/shared/runtime";
import {
  DI_LAZY_BINDING,
  DI_SINGLETON_BINDING,
  DuplicateDependencyError,
  type AnyBinding,
  type AnyDependency,
  type AnyLazyBinding,
  type DependencyValue,
} from "./types.js";

export const DI_ENV_EXTENSION = Symbol("prodkit.op.di.env");
export const MISSING_DEPENDENCY = Symbol("prodkit.op.di.missing-dependency");

export function isLazyBinding(value: unknown): value is AnyLazyBinding {
  return hasBrand(value, DI_LAZY_BINDING);
}

/** Slot identity is token class reference; `key` is diagnostic only (ADR 0010). */
export function isMatchingDependency(a: AnyDependency, b: AnyDependency): boolean {
  return a === b;
}

export type Env = Map<AnyDependency, DependencyValue<AnyDependency>>;

export function readEnv(context: RunContext<readonly unknown[]>): Env {
  const env = context.extensions.get(DI_ENV_EXTENSION);
  if (env instanceof Map) return env;
  return new Map();
}

function findProvidedToken(env: Env, dependency: AnyDependency): AnyDependency | undefined {
  for (const token of env.keys()) {
    if (isMatchingDependency(token, dependency)) return token;
  }
  return undefined;
}

function withProvisionEntry(env: Env, entry: AnyBinding): Env {
  if (findProvidedToken(env, entry.dependency) !== undefined) {
    throw new DuplicateDependencyError(entry.dependency.key);
  }
  const value = hasBrand(entry, DI_SINGLETON_BINDING) ? entry.value : entry;
  env.set(entry.dependency, value);
  return env;
}

export function resolveInjectedValue(
  env: Env,
  dependency: AnyDependency,
  signal: AbortSignal,
): unknown | PromiseLike<unknown> {
  const matchedToken = findProvidedToken(env, dependency);
  if (matchedToken === undefined) return MISSING_DEPENDENCY;

  const matchedValue = env.get(matchedToken);
  if (!isLazyBinding(matchedValue)) return matchedValue;

  const produced = matchedValue.resolve(signal);

  if (!isPromiseLike(produced)) {
    env.set(matchedToken, produced);
    return produced;
  }

  const inflight = awaitWithAbort(
    produced,
    signal,
    AbortSettlement.rejectOnAbort(() => abortReason(signal)),
  ).then(
    (resolved) => {
      env.set(matchedToken, resolved);
      return resolved;
    },
    (error) => {
      env.set(matchedToken, matchedValue);
      return Promise.reject(error);
    },
  );

  env.set(matchedToken, inflight);
  return inflight;
}

export function extendContextWithBindings(
  context: RunContext<readonly unknown[]>,
  bindings: readonly AnyBinding[],
): RunContext<readonly unknown[]> {
  const parentEnv = readEnv(context);
  const env = bindings.reduce(
    (current, entry) => withProvisionEntry(current, entry),
    new Map(parentEnv),
  );
  const extensions = new Map(context.extensions);
  extensions.set(DI_ENV_EXTENSION, env);
  return createRunContext(context.signal, context.args, extensions);
}
