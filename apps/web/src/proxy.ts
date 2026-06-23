import { NextResponse, type NextRequest } from 'next/server';

import { ACCESS_COOKIE } from '@/lib/auth/cookies';

/**
 * Route-protection proxy (Phase 3.11b-2).
 *
 * Next 16 renamed the `middleware` file convention to `proxy` (it now runs on the
 * Node.js runtime — edge is no longer offered for this file). The guard is kept
 * dependency-light regardless of runtime: it imports ONLY the `ACCESS_COOKIE`
 * constant — never `session.ts` (server-only), the api-client, or any crypto lib.
 *
 * Design — presence guard (Option 1): the proxy checks ONLY that the access
 * cookie EXISTS. It does NOT validate the token (no signature/expiry check, no
 * API call). The API stays the sole cryptographic authority; the page
 * (`getCurrentUser()`, server-side) does the real validation. A cookie that is
 * present but expired/invalid passes this coarse guard on purpose — the page then
 * resolves the user to `null` and redirects to `/login`. The two layers are
 * complementary defence-in-depth, not redundant: do NOT remove the page guard.
 */

// Deny-by-default: every route is protected EXCEPT the ones listed here.
const PUBLIC_PAGES = ['/', '/login'];
const PUBLIC_API_PREFIX = '/api/auth';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(ACCESS_COOKIE);

  // 1. Auth BFF endpoints: always let through (login/logout/refresh). Guarding
  //    them would break sign-in itself — a classic self-lockout.
  if (pathname.startsWith(PUBLIC_API_PREFIX)) {
    return NextResponse.next();
  }

  // 2. Public pages.
  if (PUBLIC_PAGES.includes(pathname)) {
    if (hasSession) {
      // UX bonus: a session-bearer should not linger on the entry pages.
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  // 3. Protected route (deny-by-default): cookie presence is required.
  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // TODO (3.11b-3+): for future protected `/api/*` proxies (BFF), return a 401
  // JSON here instead of an HTML redirect. No such route exists yet.

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run the proxy everywhere EXCEPT Next internals and static files
    // (any path containing a dot => a file extension).
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};
