import 'server-only';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import type { AuthUser } from '@/lib/auth/types';

/**
 * Shell capabilities resolved SERVER-SIDE for the shared `(app)` nav
 * (Phase 3.13-PR2).
 *
 * Scope A (locked): CLIENT + PROVIDER only. There is deliberately NO `isAdmin`
 * capability — the JWT carries only `{ sub, email, type }`, so the admin role is
 * never surfaced to the front. `/admin/verifications` stays reachable by URL and
 * guarded API-side (403); we refuse any role plumbing in this PR. Do NOT add an
 * admin capability, a role field to the JWT/DTO, or a role to the session.
 */
export interface ShellCapabilities {
  user: AuthUser | null;
  /** True iff the session resolves to an existing provider profile. */
  isProvider: boolean;
}

/**
 * Resolve `{ user, isProvider }` for the current request.
 *
 * `isProvider` reuses the EXACT dashboard pattern: `GET /service-providers/me`
 * → 200 = true, 404 = false (a 404 is NOT an error — the user simply never
 * activated Pro mode). Defensive: any other outcome (5xx, network) degrades to
 * `false` so the nav renders in client-only mode rather than crashing the layout.
 * The nav must never break the page.
 */
export async function getShellCapabilities(): Promise<ShellCapabilities> {
  const user = await getCurrentUser();
  if (!user) {
    // Unauthenticated (theoretical here — proxy.ts redirects first). No point
    // probing the provider endpoint without a session.
    return { user: null, isProvider: false };
  }

  return { user, isProvider: await resolveIsProvider() };
}

async function resolveIsProvider(): Promise<boolean> {
  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.GET('/service-providers/me');
    // Success ONLY on a 200 carrying a provider payload; 404 (not a Pro), any
    // error status, or a missing body all mean "no provider dashboard link".
    return !error && response.ok && !!data;
  } catch {
    // API unreachable / network failure — degrade gracefully.
    return false;
  }
}
