/**
 * BFF cookie contract (Phase 3.11b-1).
 *
 * The access/refresh tokens live ONLY inside these httpOnly cookies, posed by
 * Next server-side — they never reach the browser's JS context. `Secure` is
 * conditional on purpose: a `Secure` cookie is silently dropped on a plain
 * `http://localhost` origin, so in dev it must be `false` or the cookie is
 * never written at all.
 */
export const ACCESS_COOKIE = 'linkr_at';
export const REFRESH_COOKIE = 'linkr_rt';

export const baseCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

// Aligned with the API token TTLs (JWT_ACCESS_EXPIRES_IN=15m, JWT_REFRESH_EXPIRES_IN=7d).
export const ACCESS_MAX_AGE = 60 * 15; // 15 min, in seconds
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds
