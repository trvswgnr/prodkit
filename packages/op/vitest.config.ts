import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "test/**",
        "@prodkit/shared/platform-globals",
        "src/core/types.ts",
        "src/result.ts",
      ],
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage",
    },
    include: ["test/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test.ts"],
    },
  },
});
