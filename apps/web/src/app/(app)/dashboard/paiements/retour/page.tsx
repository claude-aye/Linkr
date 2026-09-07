import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { components } from '@linkr/api-client';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';

import { ConnectStatusBand } from '../../connect-status-band';

// Reads the access cookie and resyncs on arrival — never cached.
export const dynamic = 'force-dynamic';

type ConnectAccount = components['schemas']['ConnectAccountResponseDto'];

/**
 * Landing target of `CONNECT_ONBOARDING_RETURN_URL` — where Stripe sends the
 * provider back after the Express onboarding form.
 *
 * ⚠️ ARRIVING HERE IS NOT PROOF OF SUCCESS. Stripe redirects to the return URL
 * as soon as the provider LEAVES the form — completed, half-filled, or simply
 * abandoned. So this page never congratulates anyone before it has looked: it
 * resyncs from Stripe, then renders whatever the mirror actually says. The band
 * below is the whole verdict.
 *
 * ⚠️ EXACTLY ONE SYNC. No polling, no loop, no `setInterval`. `connect/sync`
 * resolves synchronously against Stripe, so the race with the BullMQ webhook is
 * extinguished at the source — there is nothing left to wait for. This render-
 * time call is the ONE exception to « sync is never triggered by a render »: the
 * navigation itself is the user action, and it happens once per return trip.
 *
 * Note this calls the API directly rather than its own BFF relay: a Server
 * Component already holds the cookie, so the relay would be a pointless hop.
 */
export default async function ConnectReturnPage() {
  // PRIVATE page under `(app)`. `redirect` throws — outside any try/catch.
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

  /**
   * `undefined` = we could not establish the state. `null` = no Connect account
   * at all, which after a return trip means onboarding was abandoned before it
   * created one — a real state, and the band says the right thing about it.
   */
  let connect: ConnectAccount | null | undefined = undefined;

  if (providerId) {
    try {
      const { data, error, response } = await client.POST(
        '/service-providers/{id}/connect/sync',
        { params: { path: { id: providerId } } },
      );
      if (response.status === 404) {
        connect = null;
      } else if (!error && response.ok && data) {
        connect = data;
      }
    } catch {
      connect = undefined;
    }

    /**
     * The sync failed (Stripe unreachable, 502…). Fall back to the mirror we
     * already hold: a stale-but-real state beats an error page, and the band
     * will still tell the provider where he stands.
     */
    if (connect === undefined) {
      try {
        const { data, error, response } = await client.GET(
          '/service-providers/{id}/connect/status',
          { params: { path: { id: providerId } } },
        );
        if (response.status === 404) {
          connect = null;
        } else if (!error && response.ok && data) {
          connect = data;
        }
      } catch {
        connect = undefined;
      }
    }
  }

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Retour de Stripe
          </h1>
          {/* Deliberately neutral: it reports what we DID, not what it achieved. */}
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Nous venons de vérifier votre compte auprès de Stripe. Voici votre
            situation actuelle.
          </p>
        </header>

        <div className="space-y-8">
          {providerId && connect !== undefined ? (
            <ConnectStatusBand
              providerId={providerId}
              account={connect}
              context="paiements"
            />
          ) : (
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Vérification impossible
              </h2>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                L’état de votre compte de paiement n’a pas pu être récupéré.
                Veuillez réessayer depuis la page de vos paiements.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-4">
            <Link
              href="/dashboard/paiements"
              className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              Voir mes paiements →
            </Link>
            <Link
              href="/dashboard"
              className="text-sm font-medium text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              Retour à mon espace pro
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
