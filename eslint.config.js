import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // `.claude` holds agent worktrees: whole checkouts of this repository, which
    // eslint would otherwise lint a second time through their copy of `bin`.
    ignores: ["dist", "src-tauri/gen", "src-tauri/target", ".references", ".claude"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  {
    files: ["bin/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ...react.configs.flat.recommended,
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ...react.configs.flat["jsx-runtime"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat["recommended-latest"],
  },
  {
    // A bare `listen` registers for the `Any` target, which Tauri delivers to
    // regardless of the window an event was emitted to. Every window would then
    // react to every repository.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/utils/events.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/api/event",
              importNames: ["listen", "once"],
              message: "Use listenToThisWindow from src/utils/events.ts so the listener is scoped to this window.",
            },
          ],
        },
      ],
    },
  },
);
