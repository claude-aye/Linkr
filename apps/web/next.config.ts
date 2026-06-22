import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Consume the workspace API client as raw TypeScript (no separate build step).
  transpilePackages: ["@linkr/api-client"],
  // NOTE: Next 16 removed the `eslint` config key and no longer runs ESLint
  // during `next build` (see node_modules/next/dist/docs/.../upgrading/version-16.md),
  // so there is nothing to disable here — lint never gates the build. Lint-green
  // is not a 3.11a acceptance criterion anyway (PROMPT_CC_3_11a §4).
};

export default nextConfig;
