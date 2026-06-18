import codspeedPlugin from "@codspeed/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [codspeedPlugin()],
  test: {
    include: ["op/tests/**/*.test.ts", "op-lint/tests/**/*.test.ts"],
  },
});
