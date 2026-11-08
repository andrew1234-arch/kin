/** Site identity for metadata, the sitemap and social cards. */
export const SITE_NAME = "Kin";
export const SITE_TITLE = "Kin: fair token launches on Base";
export const SITE_DESCRIPTION =
  "Token launches on Base that cap entities, not wallets. Wallets funded by the same source share one cap, the " +
  "evidence is committed onchain before the window opens, and a Uniswap v4 hook enforces it.";

/** Public source repository. */
export const REPO_URL = "https://github.com/andrew1234-arch/kin";

/**
 * Absolute origin used for canonical URLs, Open Graph images and the sitemap.
 * Set NEXT_PUBLIC_SITE_URL in production; on Vercel the production domain is used automatically.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/$/, "");
