import publishable from "@prodkit/shared/vitest/publishable";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  publishable,
  defineConfig({
    test: {
      passWithNoTests: true,
      coverage: {
        exclude: ["src/**/*.test.ts", "src/index.ts"],
      },
      include: ["src/**/*.test.ts"],
      typecheck: {
        include: ["src/**/*.test.ts"],
      },
    },
  }),
);
