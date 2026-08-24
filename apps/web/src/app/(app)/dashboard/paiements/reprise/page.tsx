import { redirect } from 'next/navigation';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';

// Mints a fresh Stripe link on arrival — never cached.
export const dynamic = 'force-dynamic';

/**
 * Landing target of `CONNECT_ONBOARDING_REFRESH_URL` — where Stripe sends the
 * provider when the Account Link he opened is expired or otherwise invalid
 * (they live only minutes).
 *
 * It mints ONE fresh link and forwards him to it.
 *
 * ⚠️ BUDGET OF EXACTLY ONE ATTEMPT — the naive version of this page loops.
 * Stripe sends the provider here on a stale link; if minting fails and we sent
 * him back to Stripe anyway, or retried this route, he would ride
 * reprise → link → Stripe → stale → reprise with nothing on screen ever
 * changing. So on failure he lands on `/dashboard/paiements`, which is a
 * TERMINAL destination that tells him the truth and lets him choose.
 *
 * There is nothing to render here: both outcomes are redirects. `redirect`
 * throws, so — per the Next docs and the repo's own convention — every call
 * sits OUTSIDE the try/catch.
 */
export default async function ConnectRefreshPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const client = await getServerApiClient();

  let providerId: string | null = null;
  try {
    const { data, error, response } = await client.GET('/service-providers/me');
    if (!error && response.ok && data) {
      providerId = data.id;
    }
  } catch {
    providerId = null;
  }

  let url: string | null = null;
  if (providerId) {
    try {
      const { data, error, response } = await client.POST(
        '/service-providers/{id}/connect/refresh-link',
        { params: { path: { id: providerId } } },
      );
      if (!error && response.ok && data && typeof data.url === 'string') {
        url = data.url;
      }
    } catch {
      url = null;
    }
  }

  // The one attempt succeeded — hand him back to Stripe.
  if (url) {
    redirect(url);
  }

  /**
   * It did not. Land on the payments page with a flag it knows how to explain,
   * rather than bouncing him back into Stripe on a link we could not mint.
   */
  redirect('/dashboard/paiements?lien=indisponible');
}
