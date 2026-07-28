import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Consume the workspace API client as raw TypeScript (no separate build step).
  transpilePackages: ["@linkr/api-client"],
  // Smoke mobile via tunnel HTTPS : Next bloque les requêtes cross-origin vers
  // /_next/* en dev. Le quick tunnel cloudflared change d'URL à chaque
  // redémarrage, d'où le wildcard. Dev uniquement — sans effet sur le build.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Masque l'indicateur dev de Next (la bulle « N » en bas de l'écran) qui
  // recouvrait le coin bas-gauche et volait des taps sur mobile pendant le
  // smoke. Dev only — aucun effet sur le build de prod.
  devIndicators: false,
  // NOTE: Next 16 removed the `eslint` config key and no longer runs ESLint
  // during `next build` (see node_modules/next/dist/docs/.../upgrading/version-16.md),
  // so there is nothing to disable here — lint never gates the build. Lint-green
  // is not a 3.11a acceptance criterion anyway (PROMPT_CC_3_11a §4).
};

export default nextConfig;
