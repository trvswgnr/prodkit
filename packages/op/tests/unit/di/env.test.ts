import { assert, describe, expect, test } from "vitest";
import { createRunContext } from "../../../src/execution/runtime.js";
import {
  extendContextWithBindings,
  isLazyBinding,
  MISSING_DEPENDENCY,
  readEnv,
  resolveInjectedValue,
} from "../../../src/di/env.js";
import { DuplicateDependencyError } from "../../../src/di/types.js";
import { DI } from "../../../src/di/index.js";

const DatabaseDependency = DI.Dependency("Database");

function makeDatabase() {
  return { url: "postgres://localhost/test" };
}

describe("DI env resolution", () => {
  test("resolveInjectedValue returns MISSING_DEPENDENCY when token is absent", () => {
    const context = createRunContext(new AbortController().signal);
    const env = readEnv(context);

    expect(resolveInjectedValue(env, DatabaseDependency, context.signal)).toBe(MISSING_DEPENDENCY);
  });

  test("extendContextWithBindings throws DuplicateDependencyError for duplicate token", () => {
    expect(() =>
      extendContextWithBindings(createRunContext(new AbortController().signal), [
        DI.singleton(DatabaseDependency, makeDatabase()),
        DI.singleton(DatabaseDependency, makeDatabase()),
      ]),
    ).toThrow(DuplicateDependencyError);
  });

  test("failed async scoped factory does not memoize resolved value", async () => {
    let factoryCalls = 0;
    const controller = new AbortController();
    const context = extendContextWithBindings(createRunContext(controller.signal), [
      DI.scoped(DatabaseDependency, (signal) => {
        factoryCalls += 1;
        return new Promise<ReturnType<typeof makeDatabase>>((resolve, reject) => {
          const id = setTimeout(() => resolve(makeDatabase()), 50);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(id);
              reject(signal.reason);
            },
            { once: true },
          );
        });
      }),
    ]);
    const env = readEnv(context);

    const first = resolveInjectedValue(env, DatabaseDependency, context.signal);
    assert(first instanceof Promise, "lazy scoped binding should return a promise");
    controller.abort(new Error("cancelled mid-factory"));

    await expect(first).rejects.toEqual(new Error("cancelled mid-factory"));
    expect(factoryCalls).toBe(1);
    expect(isLazyBinding(env.get(DatabaseDependency))).toBe(true);

    const retryContext = extendContextWithBindings(createRunContext(new AbortController().signal), [
      DI.scoped(DatabaseDependency, () => {
        factoryCalls += 1;
        return makeDatabase();
      }),
    ]);
    const retryEnv = readEnv(retryContext);
    const resolved = resolveInjectedValue(retryEnv, DatabaseDependency, retryContext.signal);

    expect(resolved).toEqual(makeDatabase());
    expect(factoryCalls).toBe(2);
  });
});
