// Shared ESLint flat-config base for the Linkr monorepo.
//
// Intentionally minimal in 3.11a: shared ignore globs only, with no plugin
// dependencies, so consuming apps (e.g. apps/web) can spread it on top of their
// framework config without risking resolution breakage. Lint-green is NOT a
// 3.11a acceptance criterion — see PROMPT_CC_3_11a §4.
/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/out/**",
      "**/coverage/**",
      "**/node_modules/**",
      // Generated OpenAPI types — never hand-edited, never linted.
      "**/*.d.ts",
    ],
  },
];
