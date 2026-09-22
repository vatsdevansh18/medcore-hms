const base = require("@medcore/config/eslint/base");
const globals = require("globals");

module.exports = [
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        project: "./tsconfig.eslint.json",
      },
    },
    rules: {
      // NestJS relies on empty constructors + parameter-property injection,
      // which reads as an "unused" class body to the base rule.
      "@typescript-eslint/no-useless-constructor": "off",
    },
  },
];
