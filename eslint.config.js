import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/src-tauri/**", "**/*.generated.ts", "**/node_modules/**", "apps/desktop/public/ocr/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/desktop/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Business logic and SQL belong in packages/core (AGENTS.md, review A1).
    files: ["apps/desktop/src/**/*.{ts,tsx}", "apps/desktop/mobile/**/*.{ts,tsx}"],
    ignores: ["apps/desktop/src/platform/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name=/^(select|execute|executeScript)$/][callee.object.property.name='db']",
          message: "Brugerfladen skriver ikke SQL selv. Læg forespørgslen som en funktion i packages/core.",
        },
      ],
    },
  },
);
