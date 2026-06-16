import { createRunContext, type RunContext } from "../execution/runtime.js";
import { Settlement } from "../execution/settlement.js";
import { isPromiseLike, keyIs } from "@prodkit/shared/runtime";
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
  return keyIs(value, DI_LAZY_BINDING, true);
}

export type Env = Map<AnyDependency, DependencyValue<AnyDependency>>;

export function readEnv(context: RunContext<readonly unknown[]>): Env {
  const env = context.extensions.get(DI_ENV_EXTENSION);
  if (env instanceof Map) return env;
  return new Map();
}

function withProvisionEntry(env: Env, entry: AnyBinding): Env {
  if (env.has(entry.dependency)) {
    throw new DuplicateDependencyError(entry.dependency.key);
  }
  const value = keyIs(entry, DI_SINGLETON_BINDING, true) ? entry.value : entry;
  env.set(entry.dependency, value);
  return env;
}

export function resolveInjectedValue(
  env: Env,
  dependency: AnyDependency,
  signal: AbortSignal,
): unknown | PromiseLike<unknown> {
  if (!env.has(dependency)) return MISSING_DEPENDENCY;

  const matchedValue = env.get(dependency);
  if (matchedValue === undefined || !isLazyBinding(matchedValue)) return matchedValue;

  const produced = matchedValue.resolve(signal);

  if (!isPromiseLike(produced)) {
    env.set(dependency, produced);
    return produced;
  }

  const inflight = Settlement.rejecting.awaitWork(produced, signal).then(
    (resolved) => {
      env.set(dependency, resolved);
      return resolved;
    },
    (error) => {
      env.set(dependency, matchedValue);
      return Promise.reject(error);
    },
  );

  env.set(dependency, inflight);
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
