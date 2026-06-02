import { defineConfig } from "oxlint";

export default defineConfig({
  options: {
    typeAware: true,
  },
  plugins: ["typescript", "import"],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "error",
  },
  rules: {
    "no-unused-vars": "error",
    "no-console": "error",
    eqeqeq: "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-floating-promises": ["error", { ignoreVoid: true }],
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/no-unnecessary-type-arguments": "off",
    "typescript/no-redundant-type-constituents": "off",
    "typescript/restrict-template-expressions": "off",
    "typescript/no-unnecessary-type-assertion": "off",
    "typescript/no-unnecessary-template-expression": "off",
    "typescript/no-base-to-string": "off",
    "typescript/unbound-method": "off",
    "no-await-in-loop": "off",
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    "require-yield": "off",
  },
  settings: {},
  env: {
    builtin: true,
    node: true,
  },
  globals: {},
  ignorePatterns: [],
});
