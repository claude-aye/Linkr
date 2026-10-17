/**
 * Portfolio limits, mirrored from the API (`apps/api/src/modules/portfolio/constants.ts`).
 *
 * ⚠️ KEPT IN STEP BY `scripts/check-mirrored-constants.mjs`. The upload screen
 * (P2) must refuse what the API would refuse: errors are mapped by HTTP status
 * alone (lock 3.12b), so a drift would show a 409/413/400 the screen cannot
 * explain. Written as LITERALS — the guard reads a literal, and `5 * 1024 *
 * 1024` would not be found.
 *
 * Import-free by contract: loaded as-is by `node --test`.
 */

/** Live photos per provider. */
export const PORTFOLIO_MAX_ITEMS = 12;

/** Upload ceiling, inclusive. 5 × 1024 × 1024. */
export const PORTFOLIO_MAX_BYTES = 5242880;

/** Caption length, counted after trimming. */
export const PORTFOLIO_CAPTION_MAX = 140;

/**
 * The three limits in one object, as the rules of `portfolio-rules.ts` take
 * them (that module imports nothing, so the limits are passed in).
 */
export const PORTFOLIO_LIMITS = {
  maxItems: PORTFOLIO_MAX_ITEMS,
  maxBytes: PORTFOLIO_MAX_BYTES,
  captionMax: PORTFOLIO_CAPTION_MAX,
} as const;
