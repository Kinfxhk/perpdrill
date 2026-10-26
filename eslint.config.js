import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "uploads/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Keep imports at the top of the module.",
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["packages/server/**/*.ts", "vitest.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["packages/web/src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
);
