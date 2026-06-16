import { publishableTsdown } from "@prodkit/shared/tsdown/publishable";

export default publishableTsdown({
  deps: {
    alwaysBundle: [/^@prodkit\/shared(\/|$)/],
    neverBundle: ["typescript"],
  },
  entry: ["src/index.ts"],
});
