import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Vitest/Vite can resolve workspace deps to `/@fs/...`, which Node cannot load.
    alias: {
      "@prodkit/op/internal": "../op/dist/internal.mjs",
      "@prodkit/op": "../op/dist/index.mjs",
    },
  },
  test: {
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 94,
        functions: 96,
        branches: 90,
        statements: 94,
      },
    },
    include: ["src/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["src/**/*.test.ts"],
    },
  },
});
