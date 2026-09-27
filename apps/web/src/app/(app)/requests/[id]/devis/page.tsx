import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import type { components } from '@linkr/api-client';
import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import { formatDate } from '@/lib/dates/format';
import { paymentMethodSummary, type PaymentMethod } from '@/lib/payment-methods/display';
import {
  distanceLabel,
  durationLabel,
  reputationOf,
} from '@/lib/quotes/received-quotes';

import { ReceivedQuotesList, type QuoteView } from './_components/received-quotes-list';

// Reads the access cookie + the tender's live quotes — rendered per request.
export const dynamic = 'force-dynamic';

/**
 * « Devis reçus » — the client compares the quotes of ONE of his tenders and
 * accepts one (PR 4b « Appel d'offres »).
 *
 * Server Component, same pattern as every business page: TWO reads, each in its
 * own try/catch, so neither can blank the other —
 *   1. `GET /service-requests/{id}/received-quotes` (PR 4a / 4a-bis): the quotes,
 *      with `acceptable` and `depositAmount` DECIDED BY THE SERVER. Consumed
 *      NATIVELY from the generated schema — no mirror, no cast.
 *   2. `GET /payment-methods`: only to know whether a default card exists, and to
 *      NAME it in the confirmation (« Visa •••• 4242 »).
 *
 * ⚠️ NOTHING FINANCIAL IS COMPUTED HERE. `depositAmount` comes from the same
 * arithmetic `captureDeposit` charges with (PR 4a-bis), at a rate that is an env
 * var on the API. It is formatted, never derived, never mirrored.
 *
 * Everything that needs i18n or formatting is resolved HERE and handed to the
 * client island as flat strings: the island only sorts and opens the dialog, so
 * the server render and the first client render cannot disagree.
 */

type ReceivedQuote = components['schemas']['ReceivedQuoteItemDto'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same output as the request card's money formatter (mirrored — known debt). */
function formatMoney(amount: string | null, currency: string): string | null {
  if (amount === null) return null;
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Same config as the discovery card and the profile block. */
const ratingFmt = new Intl.NumberFormat('fr-CA', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

const STATUS_LABELS: Partial<Record<ReceivedQuote['status'], string>> = {
  ACCEPTED: 'Retenu',
  REJECTED: 'Non retenu',
  EXPIRED: 'Expiré',
};

function toView(quote: ReceivedQuote): QuoteView {
  const reputation = reputationOf(quote.reviewCount, quote.averageRating);
  let reputationLabel: string | null = null;
  switch (reputation.kind) {
    case 'unavailable':
      reputationLabel = 'Réputation indisponible';
      break;
    case 'rated':
      // « avis » is invariable in French: 1 avis, 3 avis.
      reputationLabel = `★ ${ratingFmt.format(reputation.averageRating)} sur 5 · ${reputation.reviewCount} avis`;
      break;
    case 'count':
      reputationLabel = `${reputation.reviewCount} avis`;
      break;
    case 'none':
      reputationLabel = null;
  }

  const isLive = quote.status === 'SUBMITTED';
  const blocker: QuoteView['blocker'] = !isLive
    ? null
    : !quote.acceptable
      ? 'not-acceptable'
      : quote.depositAmount === null
        ? 'deposit-too-small'
        : null;

  return {
    id: quote.id,
    amount: quote.amount,
    amountLabel: formatMoney(quote.amount, quote.currency) ?? quote.amount,
    depositLabel: formatMoney(quote.depositAmount, quote.currency),
    durationLabel: durationLabel(quote.estimatedDurationMinutes),
    proposedStartLabel: quote.proposedStartAtUtc ? formatDate(quote.proposedStartAtUtc) : null,
    description: quote.description,
    statusLabel: STATUS_LABELS[quote.status] ?? null,
    isLive,
    providerName: quote.displayName,
    providerHref: quote.displayName !== null ? `/providers/${quote.serviceProviderId}` : null,
    headline: quote.displayName !== null ? quote.headline : null,
    reputationLabel,
    verificationLabel:
      quote.verificationStatus === 'VERIFIED'
        ? 'Licence vérifiée'
        : quote.verificationStatus === 'NOT_REQUIRED'
          ? 'Aucune licence requise'
          : null,
    distanceLabel: distanceLabel(quote.distanceKm),
    blocker,
  };
}

type LoadResult =
  | { kind: 'ok'; quotes: ReceivedQuote[] }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'not-a-tender' }
  | { kind: 'failed' };

export default async function ReceivedQuotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // PRIVATE page under `(app)`. `redirect`/`notFound` throw — never inside try.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { id } = await params;
  // A malformed id is a missing page, not « not a tender »: the API answers 400
  // to both, and only the second deserves its own sentence.
  if (!UUID_RE.test(id)) {
    notFound();
  }

  const client = await getServerApiClient();

  let result: LoadResult = { kind: 'failed' };
  try {
    const { data, error, response } = await client.GET(
      '/service-requests/{id}/received-quotes',
      { params: { path: { id } } },
    );
    if (!error && response.ok && Array.isArray(data)) {
      result = { kind: 'ok', quotes: data };
    } else if (response.status === 404) {
      result = { kind: 'not-found' };
    } else if (response.status === 403) {
      result = { kind: 'forbidden' };
    } else if (response.status === 400) {
      result = { kind: 'not-a-tender' };
    }
  } catch {
    result = { kind: 'failed' };
  }
  if (result.kind === 'not-found') {
    notFound();
  }

  /**
   * The default card. THREE states, and they must not collapse:
   *   - a method  → the buttons can be enabled, and the dialog names it;
   *   - `null`    → we KNOW there is none: banner + disabled buttons;
   *   - undefined → the read FAILED: we do not know. Buttons disabled too (the
   *     dialog could not name the card it charges), but the banner says we could
   *     not check — never « ajoutez une carte » to someone who may have one.
   */
  let defaultCard: PaymentMethod | null | undefined = undefined;
  if (result.kind === 'ok') {
    try {
      const { data, error, response } = await client.GET('/payment-methods');
      if (!error && response.ok && Array.isArray(data)) {
        defaultCard = data.find((m) => m.isDefault) ?? null;
      }
    } catch {
      defaultCard = undefined;
    }
  }

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <div className="mb-4">
          <Link
            href="/requests"
            className="inline-flex min-h-11 items-center text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            ← Mes demandes
          </Link>
        </div>

        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Devis reçus
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Comparez les offres reçues pour votre appel d’offres, puis retenez-en une.
          </p>
        </header>

        {result.kind === 'forbidden' ? (
          <StateCard title="Accès refusé">Cette demande ne vous appartient pas.</StateCard>
        ) : result.kind === 'not-a-tender' ? (
          <StateCard title="Aucun devis ici">
            Cette demande n’est pas un appel d’offres.
          </StateCard>
        ) : result.kind === 'failed' ? (
          <StateCard title="Chargement impossible">
            Les devis n’ont pas pu être récupérés. Veuillez réessayer plus tard.
          </StateCard>
        ) : result.quotes.length === 0 ? (
          <StateCard title="Aucun devis pour le moment">
            Les prestataires qui couvrent votre secteur peuvent vous envoyer un devis
            jusqu’à la date limite de votre appel d’offres.
          </StateCard>
        ) : (
          <>
            {defaultCard === null && (
              <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                Ajoutez une carte pour accepter un devis : l’acompte est prélevé au
                moment où vous retenez une offre.{' '}
                <Link
                  href="/account/payment-methods"
                  className="font-medium underline underline-offset-2"
                >
                  Ajouter une carte
                </Link>
              </p>
            )}
            {defaultCard === undefined && (
              <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                Vos moyens de paiement n’ont pas pu être vérifiés : l’acceptation d’un
                devis est indisponible pour le moment. Veuillez réessayer plus tard.
              </p>
            )}
            <ReceivedQuotesList
              quotes={result.quotes.map(toView)}
              cardSummary={defaultCard ? paymentMethodSummary(defaultCard) : null}
            />
          </>
        )}
      </section>
    </main>
  );
}

/** Same shell as the other pages' state cards — no new style introduced. */
function StateCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
    </div>
  );
}
