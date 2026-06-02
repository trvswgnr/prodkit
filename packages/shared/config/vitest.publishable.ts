import { defineConfig } from "vitest/config";

/** Shared vitest defaults for publishable packages (`@prodkit/op`, `@prodkit/std`). */
export default defineConfig({
  test: {
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage",
    },
    typecheck: {
      enabled: true,
    },
  },
});
