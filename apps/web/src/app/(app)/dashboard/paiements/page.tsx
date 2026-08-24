import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { components } from '@linkr/api-client';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';

import { ConnectStatusBand } from '../connect-status-band';
import { ConnectRecheckAction } from '../_actions/connect-recheck-action';

// Reads the access cookie + live Connect state — always rendered per request.
export const dynamic = 'force-dynamic';

/**
 * « Mes paiements » — the detail screen behind the dashboard's Connect band.
 *
 * Server Component: it resolves the provider, reads the Connect mirror, and
 * renders the same band plus a read-only summary. The band is rendered HERE
 * rather than in a layout, on purpose — see the note in `connect-status-band`.
 *
 * The DTO is consumed NATIVELY from the generated schema — no mirror, no cast.
 */
type ConnectAccount = components['schemas']['ConnectAccountResponseDto'];

export default async function PaiementsPage({
  searchParams,
}: {
  // `searchParams` is a Promise in Next 16 — awaited below.
  searchParams: Promise<{ lien?: string }>;
}) {
  /**
   * Set by `/dashboard/paiements/reprise` when it could not mint a fresh Stripe
   * link. That page redirects HERE rather than back to Stripe precisely so the
   * provider stops on a terminal screen instead of riding a loop — this notice
   * is the honest half of that bargain.
   */
  const { lien } = await searchParams;
  const linkUnavailable = lien === 'indisponible';

  // PRIVATE page under `(app)`. `redirect` throws — it stays outside try/catch.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const client = await getServerApiClient();

  let provider: { id: string } | null = null;
  let notPro = false;
  let failed = false;

  try {
    const { data, error, response } = await client.GET('/service-providers/me');
    if (response.status === 404) {
      notPro = true;
    } else if (error || !response.ok || !data) {
      failed = true;
    } else {
      provider = { id: data.id };
    }
  } catch {
    failed = true;
  }

  // Same three-way read as the dashboard: 404 = « never started » (a state),
  // anything else failing = « we do not know » (undefined).
  let connect: ConnectAccount | null | undefined = undefined;

  if (provider) {
    try {
      const { data, error, response } = await client.GET(
        '/service-providers/{id}/connect/status',
        { params: { path: { id: provider.id } } },
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

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Mes paiements
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            L’état de votre compte de paiement Stripe.
          </p>
        </header>

        {linkUnavailable && (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            Le lien Stripe que vous avez ouvert n’était plus valide, et nous
            n’avons pas pu en générer un nouveau. Veuillez réessayer depuis cette
            page.
          </div>
        )}

        {failed || notPro ? (
          <StateCard title={notPro ? 'Aucun profil prestataire' : 'Chargement impossible'}>
            {notPro
              ? 'Les paiements concernent les prestataires. Créez votre profil prestataire pour les configurer.'
              : 'Votre compte de paiement n’a pas pu être récupéré. Veuillez réessayer plus tard.'}
          </StateCard>
        ) : connect === undefined ? (
          <StateCard title="Chargement impossible">
            L’état de votre compte de paiement n’a pas pu être récupéré. Veuillez
            réessayer plus tard.
          </StateCard>
        ) : (
          <div className="space-y-8">
            {provider && (
              <ConnectStatusBand
                providerId={provider.id}
                account={connect}
                context="paiements"
              />
            )}

            {provider && connect && (
              <section aria-labelledby="detail-title">
                <h2
                  id="detail-title"
                  className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50"
                >
                  Détail
                </h2>

                <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                    <Detail label="Encaissement">
                      {connect.chargesEnabled
                        ? 'Vous pouvez recevoir des paiements.'
                        : 'Vous ne pouvez pas encore recevoir de paiement.'}
                    </Detail>
                    <Detail label="Versements">
                      {connect.payoutsEnabled
                        ? 'Stripe peut vous verser vos revenus.'
                        : 'Stripe ne peut pas encore vous verser vos revenus.'}
                    </Detail>
                    <Detail label="Pays">{connect.countryCode}</Detail>
                    <Detail label="Devise">{connect.defaultCurrency}</Detail>
                  </dl>

                  {/*
                    ⚠️ `requirementsCurrentlyDue` IS NEVER RENDERED, and that is a
                    decision rather than an omission. Its entries are machine
                    tokens (`individual.verification.document`, `company.tax_id`)
                    that mean nothing to a human, and translating them would
                    amount to rebuilding Stripe's own KYC interface — which would
                    then drift from it. One generic sentence and one button that
                    opens Stripe, where the real list lives and stays correct.
                    The JSONB is for diagnosis, not for display.
                  */}
                  {connect.requirementsCurrentlyDue.length > 0 && (
                    <p className="mt-4 text-sm text-amber-800 dark:text-amber-300">
                      Stripe attend des informations complémentaires. Utilisez le
                      bouton ci-dessus pour les fournir directement chez Stripe.
                    </p>
                  )}

                  {/*
                    The manual repair, reachable in every state: this is what
                    fixes a mirror left stale by a webhook that never landed.
                  */}
                  <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                    <ConnectRecheckAction
                      providerId={provider.id}
                      onboardingStatus={connect.onboardingStatus}
                      chargesEnabled={connect.chargesEnabled}
                      payoutsEnabled={connect.payoutsEnabled}
                    />
                  </div>
                </div>
              </section>
            )}

            {/*
              Honesty line — same motif as `/providers/new`: say what does not
              exist yet, and promise NO date for it.
            */}
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              L’historique de vos versements n’est pas encore disponible sur Linkr.
              En attendant, il est consultable depuis votre compte Stripe.
            </p>

            <div>
              <Link
                href="/dashboard"
                className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                ← Retour à mon espace pro
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

/** Same shell as the dashboard's card primitives — no new style introduced. */
function StateCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
  );
}
