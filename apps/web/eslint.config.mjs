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
  // ⚠️ AUCUN FORMULAIRE SOUS (auth) NE PEUT PARTIR EN GET.
  // Ces écrans soumettent par `fetch` après `preventDefault()`, ce qui masque le
  // défaut tant que le JS est hydraté. Avant hydratation — au retour d'un KYC
  // Stripe long, par exemple — la soumission native part, et sans
  // `method="post"` elle encode `password=…` dans la query string : historique du
  // navigateur, journaux des intermédiaires, en-tête `Referer` du site suivant.
  // `method="post"` ne rend pas la soumission fonctionnelle — elle échoue en 405
  // — mais elle transforme une fuite silencieuse en échec visible, ce qui est le
  // bon échange.
  {
    files: ["src/app/(auth)/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXOpeningElement[name.name='form']:not(:has(JSXAttribute[name.name='method']))",
          message:
            'Un <form> sous (auth) doit porter method="post" : sans lui, une soumission avant hydratation met les identifiants dans l’URL.',
        },
        {
          selector:
            "JSXOpeningElement[name.name='form'] > JSXAttribute[name.name='method'][value.value!='post']",
          message:
            'Sous (auth), method doit valoir littéralement "post" — une valeur dynamique ou "get" rouvre la fuite.',
        },
      ],
    },
  },
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
