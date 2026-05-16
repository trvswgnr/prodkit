import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Vitest/Vite can resolve workspace deps to `/@fs/...`, which Node cannot load.
    alias: {
      "@prodkit/op": "../op/dist/index.mjs",
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
