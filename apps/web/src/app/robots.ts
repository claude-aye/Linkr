import type { MetadataRoute } from "next";

// Version d'essai : rien ne doit être indexé (voir aussi layout.tsx et next.config.ts).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
