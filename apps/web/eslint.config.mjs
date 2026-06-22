import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import sharedBase from "@linkr/shared-config/eslint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Monorepo-shared base (shared ignore globs), consumed from
  // packages/shared-config instead of being duplicated here — see
  // PROMPT_CC_3_11a §4.
  ...sharedBase,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
