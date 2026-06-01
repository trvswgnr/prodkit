import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "tests/**",
        "@prodkit/shared/platform-globals",
        "src/core/meta.ts",
        "src/core/plan/surface.ts",
        "src/result.ts",
      ],
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage",
    },
    include: ["tests/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["tests/**/*.test.ts"],
    },
  },
});
