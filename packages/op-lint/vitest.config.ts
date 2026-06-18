import publishable from "@prodkit/shared/vitest/publishable";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  publishable,
  defineConfig({
    test: {
      coverage: {
        exclude: ["src/**/*.test.ts", "src/test-support/**"],
      },
      include: ["src/**/*.test.ts"],
      typecheck: {
        include: ["src/**/*.test.ts"],
      },
    },
  }),
);
