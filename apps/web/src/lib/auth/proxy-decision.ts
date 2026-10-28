/**
 * The routing decision of `proxy.ts`, as a pure function (R5a).
 *
 * Extracted so `node --test` can pin it: `proxy.ts` imports `next/server` and
 * `@/` aliases, which Node cannot load without the app's build. This module is
 * import-free by contract (the CI web job installs nothing). It decides WHAT to
 * do; `proxy.ts` only turns the decision into a response.
 *
 * Behaviour is the proxy's own, moved here unchanged, plus the two R5a changes:
 *  - `/` is public, in EXACT match (CLAUDE.md §13.1 nº 25);
 *  - a signed-in visitor on `/login` or `/signup` goes to `/`, not `/dashboard`.
 */

/**
 * Pages open to anonymous visitors. `/` is deliberately NOT here (see below).
 * `/signup` MUST be listed: under deny-by-default the very visitors who need it
 * would otherwise be bounced to `/login`. Its BFF needs no entry — it falls
 * under `PUBLIC_API_PREFIX`.
 */
export const PUBLIC_PAGES = ['/login', '/signup', '/forgot-password', '/reset-password'];

/**
 * Public pages that must ALSO be reachable while signed in.
 *
 * ⚠️ A NARROW EXEMPTION FROM THE SIGNED-IN BOUNCE, NOT A FIX OF IT. There is NO
 * authenticated change-password screen in this application, so the emailed reset
 * link is a signed-in user's ONLY route to a new password — on a device they no
 * longer trust, or after a session outlived their memory of the password.
 * Bouncing them away would remove their sole recourse, and make a mailed link
 * behave differently depending on whether the reader is signed in somewhere.
 * Revisit the day such a screen exists; until then it is load-bearing.
 */
export const PUBLIC_PAGES_ALLOWED_WHILE_SIGNED_IN = ['/forgot-password', '/reset-password'];

export const PUBLIC_API_PREFIX = '/api/auth';

/**
 * The public home (R5a). Exact match ONLY: `/x`, `//` or `/recherche` are not
 * the home, and a prefix test here would open the whole `(app)` group.
 *
 * NOT in `PUBLIC_PAGES`: that branch bounces a signed-in visitor away and never
 * refreshes, while `/` must serve the hub to a signed-in user — including one
 * whose access cookie just expired and whose refresh cookie is still alive.
 */
export const HOME_PATH = '/';

/** Where a signed-in visitor on `/login` or `/signup` is sent. */
export const SIGNED_IN_LANDING = '/';

export type ProxyDecision =
  /** Let the request through untouched. */
  | { kind: 'next' }
  /** HTML redirect (never used for `/api/*`). */
  | { kind: 'redirect'; to: string }
  /**
   * Exchange the refresh cookie. On failure: `deny` = clear both cookies and
   * deny (401 JSON / redirect to `/login`), `pass` = clear both cookies and let
   * the request through, WITHOUT any redirect (the home only).
   */
  | { kind: 'refresh'; onFailure: 'deny' | 'pass' }
  /** Genuinely unauthenticated: 401 JSON on `/api/*`, redirect to `/login` otherwise. */
  | { kind: 'deny' };

export interface ProxyInput {
  pathname: string;
  hasAccess: boolean;
  hasRefresh: boolean;
  /**
   * Paths always open, signed in or not, with no refresh attempted: the legal
   * pages and the portfolio images. Computed by `proxy.ts` from their own
   * import-free registries and passed in, so this module stays import-free.
   */
  isAlwaysOpen: boolean;
}

export function decideProxyRoute({
  pathname,
  hasAccess,
  hasRefresh,
  isAlwaysOpen,
}: ProxyInput): ProxyDecision {
  // 1. Auth BFF endpoints: always through. Guarding them would break sign-in.
  if (pathname.startsWith(PUBLIC_API_PREFIX)) return { kind: 'next' };

  // 1b/1c. Legal pages and portfolio images: always through, no refresh.
  if (isAlwaysOpen) return { kind: 'next' };

  // 1d. The home (R5a), EXACT match. Never a redirect: the page itself picks
  //     the landing (no user) or the hub (user). A refresh is still attempted so
  //     a returning visitor whose access cookie expired gets the hub, but its
  //     failure lets the request through — the visitor simply sees the landing.
  if (pathname === HOME_PATH) {
    if (hasAccess) return { kind: 'next' };
    if (hasRefresh) return { kind: 'refresh', onFailure: 'pass' };
    return { kind: 'next' };
  }

  // 2. Public pages. Never a refresh here — only the access cookie's presence.
  if (PUBLIC_PAGES.includes(pathname)) {
    if (hasAccess && !PUBLIC_PAGES_ALLOWED_WHILE_SIGNED_IN.includes(pathname)) {
      return { kind: 'redirect', to: SIGNED_IN_LANDING };
    }
    return { kind: 'next' };
  }

  // 3. Protected route (deny-by-default).
  if (hasAccess) return { kind: 'next' };
  if (hasRefresh) return { kind: 'refresh', onFailure: 'deny' };
  return { kind: 'deny' };
}
