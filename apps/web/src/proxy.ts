import { NextResponse, type NextRequest } from 'next/server';

import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  baseCookieOptions,
} from '@/lib/auth/cookies';
import { refreshTokens } from '@/lib/auth/refresh';

/**
 * Route-protection proxy (Phase 3.11b-3).
 *
 * Next 16 renamed the `middleware` file convention to `proxy` (it now runs on the
 * Node.js runtime — edge is no longer offered for this file). Node runtime is what
 * lets the refresh branch below issue a server-to-server `fetch`. The guard stays
 * dependency-light: it imports ONLY the cookie contract + the refresh helper —
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
 */

// Deny-by-default: every route is protected EXCEPT the ones listed here.
// `/` is now the authenticated client hub (3.13-PR2) — no longer public.
const PUBLIC_PAGES = ['/login'];
const PUBLIC_API_PREFIX = '/api/auth';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAccess = request.cookies.has(ACCESS_COOKIE);

  // 1. Auth BFF endpoints: always let through (login/logout/refresh). Guarding
  //    them would break sign-in itself — a classic self-lockout.
  if (pathname.startsWith(PUBLIC_API_PREFIX)) {
    return NextResponse.next();
  }

  // 2. Public pages. We NEVER refresh here — public pages only care about the
  //    access cookie's presence (a bonus-UX bounce to the dashboard).
  if (PUBLIC_PAGES.includes(pathname)) {
    if (hasAccess) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  // 3. Protected route (deny-by-default). For a future protected `/api/*` BFF
  //    proxy we'd return a 401 JSON instead of an HTML redirect here, but no such
  //    route exists yet.
  //    3a. Access cookie present → let through (unchanged; page does real auth).
  if (hasAccess) {
    return NextResponse.next();
  }

  //    3b. Access gone but refresh still present → attempt a silent refresh.
  const refreshValue = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshValue) {
    return attemptRefresh(request, refreshValue);
  }

  //    3c. Neither cookie → genuinely unauthenticated.
  return NextResponse.redirect(new URL('/login', request.url));
}

/**
 * Exchange the refresh cookie for a fresh pair, then either:
 *  - SUCCESS → R2 double-write (request header rewrite + response Set-Cookie), or
 *  - FAILURE → redirect-clear (fail-safe strict, both cookies dropped).
 */
async function attemptRefresh(request: NextRequest, refreshToken: string) {
  const result = await refreshTokens(refreshToken);

  // FAIL-SAFE STRICT: an invalid/expired refresh (401/403), a 5xx, or an
  // unreachable API all land here → clean logout. No retry, no degraded mode.
  if (!result.ok) {
    const redirect = NextResponse.redirect(new URL('/login', request.url));
    redirect.cookies.delete(ACCESS_COOKIE);
    redirect.cookies.delete(REFRESH_COOKIE);
    return redirect;
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
