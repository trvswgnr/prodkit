import { publishableTsdown } from "@prodkit/shared/tsdown/publishable";

export default publishableTsdown({
  entry: [
    "src/index.ts",
    "src/di/index.ts",
    "src/hkt.ts",
    "src/internal/index.ts",
    "src/policy/index.ts",
  ],
  dts: {
    resolver: "tsc",
    eager: true,
  },
});
