/**
 * Server-side token refresh helper (Phase 3.11b-3).
 *
 * Called ONLY from the proxy, on the "access cookie absent + refresh cookie
 * present" path (the 15-min expiry case: the browser auto-drops `linkr_at` at its
 * maxAge while `linkr_rt` lives 7 days). It exchanges the refresh token for a
 * fresh pair via the backend.
 *
 * Backend contract (source of truth: apps/api/src/modules/auth/auth.controller.ts
 * + auth.service.ts):
 *   - `POST /auth/refresh` is `@Public()` — no Authorization header.
 *   - The refresh token travels in the JSON BODY: `{ refreshToken }`.
 *   - The response is a ROTATED `{ accessToken, refreshToken }` pair (a brand-new
 *     refresh token, NO user) — so the caller must repose BOTH cookies.
 *   - An invalid/expired refresh → `401`.
 *
 * Fail-safe strict: ANY non-2xx response (401/403, or a 5xx), a malformed body,
 * AND any thrown error (API unreachable) all collapse to `{ ok: false }`. There is
 * no degraded mode — the caller clears both cookies and redirects to `/login`.
 *
 * No `next/headers` / `server-only` import on purpose: this module is consumed by
 * the proxy (Node runtime), which must stay free of those server-component-scoped
 * APIs. NEVER log a token here.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false };

export async function refreshTokens(refreshToken: string): Promise<RefreshResult> {
  let apiResponse: Response;
  try {
    apiResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
  } catch {
    // API unreachable / network failure — fail-safe.
    return { ok: false };
  }

  // 401/403 (invalid/expired refresh) or any 5xx → fail-safe, no degraded mode.
  if (!apiResponse.ok) return { ok: false };

  try {
    const pair = (await apiResponse.json()) as {
      accessToken?: unknown;
      refreshToken?: unknown;
    };
    // Rotation means BOTH must be present strings; a malformed body is a failure
    // (never write `undefined` into a cookie).
    if (typeof pair.accessToken !== 'string' || typeof pair.refreshToken !== 'string') {
      return { ok: false };
    }
    return { ok: true, accessToken: pair.accessToken, refreshToken: pair.refreshToken };
  } catch {
    return { ok: false };
  }
}
