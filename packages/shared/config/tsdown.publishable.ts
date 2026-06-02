import { defineConfig, type UserConfig } from "tsdown";

/** Shared tsdown defaults for publishable packages (`@prodkit/op`, `@prodkit/std`). */
export function publishableTsdown(config: UserConfig) {
  return defineConfig({
    format: ["esm"],
    dts: {
      resolver: "tsc",
    },
    clean: true,
    sourcemap: true,
    deps: {
      alwaysBundle: [/^@prodkit\/shared(\/|$)/],
    },
    ...config,
  });
}
