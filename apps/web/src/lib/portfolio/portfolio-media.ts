/**
 * The web relay of portfolio images — `/media/portfolio/{itemId}` (P1).
 *
 * WHY A RELAY. Every `<img>` of the portfolio (P2, P3) points at a RELATIVE URL
 * on the web origin, never at the API: the browser only ever talks to this
 * server. That is what makes the photos work through the Cloudflared tunnel
 * (which exposes port 3001 only) and behind the production reverse proxy, and
 * it keeps the API's address out of every page. The API's own image route
 * (`GET /portfolio/{itemId}/image`) is reached SERVER-SIDE only.
 *
 * Import-free by contract: `proxy.ts` and the route handler import it, and
 * `node --test` loads it as-is (the CI web job installs nothing). The route
 * file is only the wiring around `relayPortfolioImage`.
 */

/** URL prefix of the relay. Quasi-immutable: it is what the API returns as `imageUrl`. */
export const PORTFOLIO_MEDIA_PREFIX = '/media/portfolio/';

/** RFC 4122 shape, any version — the same leniency as Nest's `ParseUUIDPipe`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The headers copied from the API's answer. Nothing else crosses the relay. */
export const RELAYED_HEADERS = [
  'content-type',
  'content-length',
  'cache-control',
  'x-content-type-options',
] as const;

/**
 * Is this pathname a portfolio image? Used by `proxy.ts` to let it through
 * WITHOUT a session: the images are public, and under deny-by-default an
 * anonymous visitor would otherwise be redirected to `/login` — an `<img>`
 * that receives an HTML login page simply shows nothing.
 *
 * Exactly one segment after the prefix, nothing deeper: `/media/portfolio/`
 * alone, or `/media/portfolio/a/b`, stay protected.
 */
export function isPortfolioMediaPath(pathname: string): boolean {
  if (!pathname.startsWith(PORTFOLIO_MEDIA_PREFIX)) return false;
  const rest = pathname.slice(PORTFOLIO_MEDIA_PREFIX.length);
  return rest.length > 0 && !rest.includes('/');
}

export function isValidItemId(itemId: string): boolean {
  return UUID_RE.test(itemId);
}

/**
 * Relays one image. `fetchImage` performs the SERVER-SIDE call to the API and
 * resolves to its raw `Response` (or throws when the API is unreachable).
 *
 * - malformed id → 404, and the API is NOT called;
 * - API 200 → the body is streamed through untouched, with RELAYED_HEADERS only;
 * - API 404 (or any other status) → that status, with an empty body and
 *   `Cache-Control: no-store` — an error must not be cached as an image;
 * - API unreachable → 502.
 */
export async function relayPortfolioImage(
  itemId: string,
  fetchImage: (itemId: string) => Promise<Response>,
): Promise<Response> {
  if (!isValidItemId(itemId)) {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  let upstream: Response;
  try {
    upstream = await fetchImage(itemId);
  } catch {
    return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
  }

  if (upstream.status !== 200) {
    // The status only: the API's error body is JSON meant for API clients, and
    // an `<img>` has no use for it.
    await upstream.body?.cancel().catch(() => undefined);
    return new Response(null, {
      status: upstream.status,
      headers: { 'cache-control': 'no-store' },
    });
  }

  const headers = new Headers();
  for (const name of RELAYED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
