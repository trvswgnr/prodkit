import publishable from "@prodkit/shared/vitest/publishable";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  publishable,
  defineConfig({
    test: {
      coverage: {
        // Compile-time runnable gating modules; line coverage is not the regression signal.
        // Gate: pnpm --filter @prodkit/tools run runnable-gating:check
        exclude: [
          "tests/**",
          "@prodkit/shared/platform-globals",
          "src/core/metadata.ts",
          "src/core/surface.ts",
          "src/result.ts",
        ],
      },
      include: ["tests/**/*.test.ts"],
      typecheck: {
        include: ["tests/**/*.test.ts"],
      },
    },
  }),
);
