/**
 * Portfolio limits (P1).
 *
 * ⚠️ THE THREE FIRST CONSTANTS ARE MIRRORED IN THE WEB APP
 * (`apps/web/src/lib/portfolio/portfolio-limits.ts`) and checked by
 * `scripts/check-mirrored-constants.mjs`. Change both sides together: the
 * upload screen (P2) refuses what the API would refuse, and errors are mapped
 * by HTTP status alone (lock 3.12b), so a drift would be a 409/413/400 that the
 * screen cannot explain.
 *
 * They are written as LITERALS on purpose: the guard reads a literal, and
 * `5 * 1024 * 1024` would not be found.
 */

/** Live (non-deleted) photos per provider. The 13th is refused with 409. */
export const PORTFOLIO_MAX_ITEMS = 12;

/** Upload ceiling, enforced by the multipart parser BEFORE the body is read whole (413). 5 × 1024 × 1024. */
export const PORTFOLIO_MAX_BYTES = 5242880;

/** Caption length, counted AFTER trimming. Also a CHECK on the column. */
export const PORTFOLIO_CAPTION_MAX = 140;

/**
 * Decompression-bomb guard: an input whose width × height exceeds this is
 * refused (422) before any pixel is decoded. ≈ 40 megapixels covers the
 * default output of phone cameras (12 to 24 MP). A photo taken in a phone's
 * full-resolution mode (48, 50 or 200 MP) IS refused — assumed: the stored
 * image is 1600 px anyway. Not mirrored — the web cannot know the pixel count
 * before sending.
 */
export const PORTFOLIO_MAX_INPUT_PIXELS = 40_000_000;

/** Longest side of the stored image, in pixels. Never upscaled. */
export const PORTFOLIO_OUTPUT_MAX_SIDE = 1600;

/** WebP quality of the stored image. */
export const PORTFOLIO_WEBP_QUALITY = 82;

/** The only content type ever stored: every upload is re-encoded to WebP. */
export const PORTFOLIO_CONTENT_TYPE = 'image/webp';

/** Input formats accepted, as read from the BYTES by sharp — never from the extension or the declared type. */
export const PORTFOLIO_ACCEPTED_FORMATS: readonly string[] = ['jpeg', 'png', 'webp'];

/**
 * Relative URL of a portfolio image, served by the WEB app's relay
 * (`/media/portfolio/{itemId}`). ⚠️ The API never builds an absolute URL and
 * never names its own host: the browser only ever talks to the web origin, so
 * the image also works through the Cloudflared tunnel (port 3001 only) and
 * behind the production reverse proxy.
 */
export function portfolioImageUrl(itemId: string): string {
  return `/media/portfolio/${itemId}`;
}
