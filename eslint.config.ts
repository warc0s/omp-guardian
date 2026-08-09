import js from "@eslint/js"
import tseslint from "typescript-eslint"
import prettierConfig from "eslint-config-prettier"
import globals from "globals"

// ESLint flat config. Intentionally limited to `recommended` (non-type-checked):
// the codebase makes heavy use of `as` casts
// and `Record<string, unknown>` narrowing that `recommendedTypeChecked` would
// flag in the hundreds without materially improving this safety boundary.
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "tests/live-fixture/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        Bun: "readonly",
      },
    },
  },
  // Flat config does not deep-merge; later entries win whole, so
  // eslint-config-prettier must be LAST to disable conflicting formatting rules.
  prettierConfig,
)
