import { NextResponse, type NextRequest } from 'next/server';

import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  baseCookieOptions,
} from '@/lib/auth/cookies';
import { decideProxyRoute } from '@/lib/auth/proxy-decision';
import { refreshTokens } from '@/lib/auth/refresh';
import { resolveClientIp } from '@/lib/http/client-ip';
import { LEGAL_PATHS } from '@/lib/legal/legal-pages';
import { isPortfolioMediaPath } from '@/lib/portfolio/portfolio-media';

/**
 * Route-protection proxy (Phase 3.11b-3).
 *
 * Next 16 renamed the `middleware` file convention to `proxy` (it now runs on the
 * Node.js runtime — edge is no longer offered for this file). Node runtime is what
 * lets the refresh branch below issue a server-to-server `fetch`. The guard stays
 * dependency-light: it imports ONLY the cookie contract, the refresh helper, the
 * client-IP helper, the routing decision, the legal-pages registry and the
 * portfolio-media predicate (the last three import-free by contract) —
 * never `session.ts` (server-only), the api-client, or any crypto lib.
 *
 * Design — presence guard (Option 1): routing is decided ONLY on cookie EXISTENCE.
 * No token is ever validated or decoded here (no signature/expiry check). The API
 * stays the sole cryptographic authority; the page (`getCurrentUser()`,
 * server-side) does the real validation. A cookie present-but-expired passes this
 * coarse guard on purpose — the page then resolves the user to `null` and
 * redirects. The two layers are complementary defence-in-depth: do NOT remove the
 * page guard.
 *
 * Silent refresh (b-3): when `linkr_at` is gone but `linkr_rt` is still here (the
 * browser auto-dropped the 15-min access cookie at its maxAge while the 7-day
 * refresh cookie lives on), regenerate the pair silently — still presence-only, no
 * JWT decode. See `attemptRefresh`.
 *
 * Response shape: an `/api/*` request ALWAYS gets JSON, never HTML — see
 * `denyUnauthenticated`, the single place that arbitrates 401-JSON vs
 * redirect-HTML.
 */

// Deny-by-default: every route is protected EXCEPT the ones `decideProxyRoute`
// lets through (`lib/auth/proxy-decision.ts`, import-free and unit-tested). The
// public-page lists, the `/` home branch (R5a) and the signed-in bounce all live
// there; this file only turns a decision into a response.
const API_PREFIX = '/api/';

// Not meant for direct display — the front maps by HTTP code alone (locked since
// 3.12b). It still respects the project-wide vouvoiement.
const UNAUTHENTICATED_MESSAGE = 'Votre session a expiré. Veuillez vous reconnecter.';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const refreshValue = request.cookies.get(REFRESH_COOKIE)?.value;

  const decision = decideProxyRoute({
    pathname,
    hasAccess: request.cookies.has(ACCESS_COOKIE),
    hasRefresh: Boolean(refreshValue),
    // Legal pages (PR L1) and portfolio images (P1): always through, signed in
    // or not, no refresh attempted. ⚠️ The legal pages are deliberately NOT
    // public pages: that branch bounces a signed-in visitor away, so a
    // logged-in user clicking « Confidentialité » would never reach the policy.
    // Portfolio images are public (the API route is `@Public()`); an `<img>`
    // that received the `/login` page would show nothing.
    isAlwaysOpen: LEGAL_PATHS.includes(pathname) || isPortfolioMediaPath(pathname),
  });

  switch (decision.kind) {
    case 'next':
      return NextResponse.next();
    case 'redirect':
      return NextResponse.redirect(new URL(decision.to, request.url));
    case 'refresh':
      // `refreshValue` is set whenever the decision is `refresh`.
      return attemptRefresh(request, refreshValue as string, decision.onFailure);
    case 'deny':
      // Neither cookie → genuinely unauthenticated. Nothing to purge.
      return denyUnauthenticated(request, { clearCookies: false });
  }
}

/**
 * THE single decision point for "this request is not authenticated": 401 JSON for
 * `/api/*`, HTML redirect to `/login` for everything else. Every deny path in
 * this file routes through here — no duplicated condition at each exit.
 *
 * WHY: `fetch('/api/…')` follows a redirect transparently. The caller received
 * the `/login` HTML page with a 200 — `res.ok` true, `res.json()` throwing inside
 * its own catch — and read that as an empty result rather than an auth failure.
 * In the request form that mis-read fabricated a fake location (the Québec
 * placeholder) on a perfectly credible typed address; the 15-min access token
 * makes it reachable by simply filling a form slowly on a phone.
 *
 * Discrimination is on the path prefix ONLY — never `Accept`, never
 * `sec-fetch-mode`. The path is the sole source of truth. `/api/auth/*` never
 * reaches this helper: it short-circuits at step 1, so sign-in is unaffected.
 *
 * `clearCookies` mirrors the response each caller replaces. A freshly built JSON
 * response carries NONE of the `Set-Cookie` of the redirect it stands in for, so
 * the fail-safe path must re-pose both deletions — a client that gets a 401
 * without the purge stays stuck with dead cookies.
 *
 * Those deletions target `path` EXPLICITLY. A `Set-Cookie` expiry only clears a
 * cookie whose Path matches, and a bare `delete(name)` defaults to the request's
 * own path — from `/api/geocode` it would emit `Path=/api`, missing the real
 * cookies entirely. Both are always posed with `baseCookieOptions.path` (login
 * route + the R2 double-write below — the only two writers, same options), so
 * reusing that constant keeps the purge aligned with the contract by
 * construction.
 */
function denyUnauthenticated(
  request: NextRequest,
  { clearCookies }: { clearCookies: boolean },
) {
  const response = request.nextUrl.pathname.startsWith(API_PREFIX)
    ? NextResponse.json({ message: UNAUTHENTICATED_MESSAGE }, { status: 401 })
    : NextResponse.redirect(new URL('/login', request.url));

  if (clearCookies) {
    clearAuthCookies(response);
  }

  return response;
}

/** Drop both auth cookies, on the path they were posed with (see above). */
function clearAuthCookies(response: NextResponse) {
  response.cookies.delete({ name: ACCESS_COOKIE, path: baseCookieOptions.path });
  response.cookies.delete({ name: REFRESH_COOKIE, path: baseCookieOptions.path });
}

/**
 * Exchange the refresh cookie for a fresh pair, then either:
 *  - SUCCESS → R2 double-write (request header rewrite + response Set-Cookie), or
 *  - FAILURE → both cookies dropped, then `onFailure`:
 *      `deny` → deny-clear (fail-safe strict), every protected route;
 *      `pass` → let the request through WITHOUT redirect — the home `/` only
 *               (R5a). The request still carries the dead refresh cookie and no
 *               access cookie, so the page resolves no user and renders the
 *               landing. A redirect here would send a returning visitor with a
 *               stale cookie to `/login` instead of the public home.
 */
async function attemptRefresh(
  request: NextRequest,
  refreshToken: string,
  onFailure: 'deny' | 'pass',
) {
  // The visitor's address rides along, same as the auth relays do — this hop is
  // server-to-server too, so without it the API would meter this server.
  const result = await refreshTokens(refreshToken, resolveClientIp(request));

  // FAIL-SAFE STRICT: an invalid/expired refresh (401/403), a 5xx, or an
  // unreachable API all land here → clean logout. No retry, no degraded mode.
  // The decision to refresh, the rotation and the R2 double-write below are
  // untouched — only the SHAPE of this failure response varies (see the helper).
  if (!result.ok) {
    if (onFailure === 'pass') {
      const response = NextResponse.next();
      clearAuthCookies(response);
      return response;
    }
    return denyUnauthenticated(request, { clearCookies: true });
  }

  // SUCCESS → R2 double-write. The backend ROTATES the refresh token, so BOTH
  // cookies must be reposed.
  //
  // (1) Request side: rewrite the `cookie` header so THIS render's Server
  //     Component (`getCurrentUser`, which reads the *request* cookies) already
  //     sees the new access token — no round-trip redirect needed (that would be
  //     R1; this is R2).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    'cookie',
    buildCookieHeader(request, {
      [ACCESS_COOKIE]: result.accessToken,
      [REFRESH_COOKIE]: result.refreshToken,
    }),
  );
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // (2) Response side: Set-Cookie so the BROWSER persists the new pair. This is
  //     ALSO the anti-loop: the next navigation carries `linkr_at` → branch 3a
  //     short-circuits, no re-refresh. Omitting (2) = a silent re-refresh on every
  //     navigation; omitting (1) = the current render still 401s. Both required.
  response.cookies.set(ACCESS_COOKIE, result.accessToken, {
    ...baseCookieOptions,
    maxAge: ACCESS_MAX_AGE,
  });
  response.cookies.set(REFRESH_COOKIE, result.refreshToken, {
    ...baseCookieOptions,
    maxAge: REFRESH_MAX_AGE,
  });

  return response;
}

/**
 * Rebuild the request `cookie` header, overriding/adding the given cookies while
 * PRESERVING every other cookie. Reused for the R2 request-side write so a partial
 * header never drops unrelated cookies.
 */
function buildCookieHeader(
  request: NextRequest,
  overrides: Record<string, string>,
): string {
  const jar = new Map<string, string>();
  for (const { name, value } of request.cookies.getAll()) {
    jar.set(name, value);
  }
  for (const [name, value] of Object.entries(overrides)) {
    jar.set(name, value);
  }
  return Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ');
}

export const config = {
  matcher: [
    // Run the proxy everywhere EXCEPT Next internals and static files
    // (any path containing a dot => a file extension).
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};
