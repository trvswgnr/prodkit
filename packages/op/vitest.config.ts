import publishable from "@prodkit/shared/vitest/publishable";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  publishable,
  defineConfig({
    test: {
      coverage: {
        exclude: [
          "tests/**",
          "@prodkit/shared/platform-globals",
          "src/core/meta.ts",
          "src/core/plan/surface.ts",
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
