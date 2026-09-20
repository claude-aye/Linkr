import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import {
  formatExpiry,
  paymentMethodDigits,
  paymentMethodLabel,
  paymentMethodSummary,
  type PaymentMethod,
} from '@/lib/payment-methods/display';

import { AddCardSection } from './_components/add-card-section';
import { CardActions } from './_components/card-actions';

// Reads the access cookie + the caller's live payment methods — per request.
export const dynamic = 'force-dynamic';

/**
 * « Mes moyens de paiement » — the screen a client reaches from the
 * deposit-failure email, and the only place a saved card can be added, promoted
 * or removed.
 *
 * ⚠️ THE URL IS QUASI-IMMUTABLE. `/account/payment-methods` is built into
 * `deposit-failed-client` and leaves in mail that outlives any refactor. A
 * future `(account)` layout may wrap this route, but the segment itself does not
 * move; if it ever has to, the old path must keep redirecting here.
 *
 * Server Component, same pattern as `/dashboard/paiements`: it resolves the
 * session, reads the list with the cookie server-side, and hands the two client
 * islands (`AddCardSection`, `CardActions`) nothing but ids and display strings.
 * The DTO is consumed NATIVELY from the generated schema — no mirror, no cast.
 *
 * ⚠️ NO ROLE GATE. Every account can hold a payment method (a provider is a
 * client of other providers), and the API scopes the list to the caller's own
 * rows. A `isProvider`-style condition here would hide the screen from the
 * people the email sends to it.
 */
export default async function PaymentMethodsPage() {
  // PRIVATE page under `(app)`. `redirect` throws — it stays outside try/catch.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const client = await getServerApiClient();

  // `null` = « we do not know » (the read failed); `[]` = « we know: none ».
  // The two states must not collapse: one is an error, the other is the normal
  // state of a client who has just had their only card removed.
  let methods: PaymentMethod[] | null = null;
  try {
    const { data, error, response } = await client.GET('/payment-methods');
    if (!error && response.ok && Array.isArray(data)) {
      methods = data;
    }
  } catch {
    methods = null;
  }

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Mes moyens de paiement
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Les cartes utilisées pour régler l’acompte de vos demandes.
            </p>
          </div>
          <AddCardSection />
        </header>

        {methods === null ? (
          <StateCard title="Chargement impossible">
            Vos moyens de paiement n’ont pas pu être récupérés. Veuillez réessayer
            plus tard.
          </StateCard>
        ) : methods.length === 0 ? (
          /*
            ⚠️ THE EMPTY STATE IS THE ARRIVAL STATE. A client whose card was
            declined and then removed lands here from the email — on a page with
            nothing on it. It has to say what happened is normal, what to do, and
            what it unblocks. A bare « Aucun moyen de paiement » would read as a
            broken page at the worst possible moment.
          */
          <StateCard title="Aucun moyen de paiement enregistré">
            Enregistrez une carte pour régler l’acompte de vos demandes. Le
            prestataire pourra ensuite relancer le prélèvement.
          </StateCard>
        ) : (
          <ul className="space-y-4">
            {methods.map((method) => (
              <li
                key={method.id}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {paymentMethodLabel(method)}
                  </span>
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {paymentMethodDigits(method)}
                  </span>
                  {method.isDefault && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      Par défaut
                    </span>
                  )}
                </div>

                {/* No expiry on a bank account, and none invented on a card. */}
                {formatExpiry(method) && (
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Expire le {formatExpiry(method)}
                  </p>
                )}

                <CardActions
                  id={method.id}
                  isDefault={method.isDefault}
                  summary={paymentMethodSummary(method)}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8">
          <Link
            href="/requests"
            className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            ← Retour à mes demandes
          </Link>
        </div>
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
