import { requireYieldStarRule } from "./rules/require-yield-star.js";

export { requireYieldStarRule } from "./rules/require-yield-star.js";

export const rules = {
  "require-yield-star": requireYieldStarRule,
};

export const plugin = {
  meta: {
    name: "@prodkit/op-lint",
  },
  rules,
};

export default plugin;
