import { defineConfig } from "vitest/config";

/** Shared vitest defaults for publishable `@prodkit/*` packages. */
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
