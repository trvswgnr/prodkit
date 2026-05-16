import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/internal.ts"],
  format: ["esm"],
  dts: {
    resolver: "tsc",
  },
  clean: true,
  sourcemap: true,
});
