'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { sortReceivedQuotes, type QuoteSortMode } from '@/lib/quotes/received-quotes';

/**
 * The client island of « Devis reçus » (PR 4b) — the sort toggle, the cards, and
 * the accept confirmation. Every string arrives resolved by the Server
 * Component; nothing here formats money, rates a provider, or computes a
 * deposit.
 */
export interface QuoteView {
  id: string;
  /** Raw decimal string — the sort key only, compared in cents (pure module). */
  amount: string;
  amountLabel: string;
  /** Server-computed deposit, formatted. NEVER recomputed on the web. */
  depositLabel: string | null;
  durationLabel: string;
  proposedStartLabel: string | null;
  description: string;
  /** « Retenu » / « Non retenu » / « Expiré »; null on a live quote. */
  statusLabel: string | null;
  isLive: boolean;
  /** Null when the provider was deleted → « Prestataire indisponible », no link. */
  providerName: string | null;
  providerHref: string | null;
  headline: string | null;
  reputationLabel: string | null;
  verificationLabel: string | null;
  distanceLabel: string | null;
  /** Why a LIVE quote cannot be accepted; null when it can (card aside). */
  blocker: 'not-acceptable' | 'deposit-too-small' | null;
}

const UNEXPECTED_MESSAGE =
  'Service momentanément indisponible. Veuillez réessayer plus tard.';

/**
 * Accept errors → FROZEN French copy, BY HTTP STATUS ALONE (lock 3.12b). 200 and
 * 202 are both successes and never reach here; they navigate.
 */
function acceptErrorMessage(status: number): string {
  switch (status) {
    case 409:
      return 'Ce devis ne peut plus être accepté. Rafraîchissez la page.';
    case 403:
    case 404:
      return 'Ce devis est introuvable.';
    default:
      return UNEXPECTED_MESSAGE;
  }
}

/**
 * The result reaches `/requests` as a query flag, where the banner says it — the
 * dialog closes on navigation, and a message shown only here would vanish with
 * it. 202 has its OWN flag: the client must be told his deposit failed, and no
 * retry button is offered anywhere (`retry-deposit` is the assigned provider's;
 * a client would get 403).
 */
const RESULT_FLAG: Record<200 | 202, string> = {
  200: 'accepte',
  202: 'acompte-en-echec',
};

const SORT_OPTIONS: Array<{ mode: QuoteSortMode; label: string }> = [
  { mode: 'arrival', label: 'Ordre d’arrivée' },
  { mode: 'price', label: 'Prix croissant' },
];

export function ReceivedQuotesList({
  quotes,
  cardSummary,
}: {
  quotes: QuoteView[];
  /** « Visa •••• 4242 », or null when no usable default card is known. */
  cardSummary: string | null;
}) {
  const router = useRouter();
  const [sortMode, setSortMode] = useState<QuoteSortMode>('arrival');
  const [accepting, setAccepting] = useState<QuoteView | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const sorted = useMemo(() => sortReceivedQuotes(quotes, sortMode), [quotes, sortMode]);

  function changeSort(mode: QuoteSortMode) {
    setSortMode(mode);
    setAnnouncement(
      mode === 'price' ? 'Devis triés par prix croissant.' : 'Devis triés par ordre d’arrivée.',
    );
  }

  async function confirmAccept(quote: QuoteView): Promise<void> {
    let status: number;
    try {
      const res = await fetch(`/api/quotes/${quote.id}/accept`, { method: 'POST' });
      status = res.status;
    } catch {
      throw new Error(UNEXPECTED_MESSAGE);
    }
    if (status === 200 || status === 202) {
      router.push(`/requests?devis=${RESULT_FLAG[status]}`);
      router.refresh();
      return;
    }
    throw new Error(acceptErrorMessage(status));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span id="quote-sort-label" className="text-sm text-zinc-600 dark:text-zinc-400">
          Trier par :
        </span>
        <div role="group" aria-labelledby="quote-sort-label" className="flex flex-wrap gap-2">
          {SORT_OPTIONS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={sortMode === mode}
              onClick={() => changeSort(mode)}
              className="min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 aria-pressed:border-zinc-900 aria-pressed:bg-zinc-900 aria-pressed:text-white dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:aria-pressed:border-zinc-50 dark:aria-pressed:bg-zinc-50 dark:aria-pressed:text-zinc-900"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Present in the DOM even when empty: a region inserted together with its
          content is often not announced. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <ul className="space-y-4">
        {sorted.map((quote) => (
          <QuoteCard
            key={quote.id}
            quote={quote}
            canPay={cardSummary !== null}
            onAccept={() => setAccepting(quote)}
          />
        ))}
      </ul>

      <ConfirmDialog
        isOpen={accepting !== null}
        onClose={() => setAccepting(null)}
        title="Accepter ce devis ?"
        confirmLabel="Confirmer"
        onConfirm={() => (accepting ? confirmAccept(accepting) : Promise.resolve())}
      >
        {accepting && (
          <dl className="space-y-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Prestataire
              </dt>
              <dd className="text-zinc-800 dark:text-zinc-200">
                {accepting.providerName ?? 'Prestataire indisponible'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Montant du devis
              </dt>
              <dd className="text-zinc-800 dark:text-zinc-200">{accepting.amountLabel}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Acompte prélevé maintenant
              </dt>
              <dd className="font-semibold text-zinc-900 dark:text-zinc-50">
                {accepting.depositLabel}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Carte utilisée
              </dt>
              <dd className="text-zinc-800 dark:text-zinc-200">{cardSummary}</dd>
            </div>
            <p className="pt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Les autres devis de cet appel d’offres seront refusés.
            </p>
          </dl>
        )}
      </ConfirmDialog>
    </div>
  );
}

function QuoteCard({
  quote,
  canPay,
  onAccept,
}: {
  quote: QuoteView;
  canPay: boolean;
  onAccept: () => void;
}) {
  const acceptable = quote.isLive && quote.blocker === null;
  return (
    <li className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {quote.providerName !== null && quote.providerHref !== null ? (
            <Link
              href={quote.providerHref}
              // Standalone link, not inline in a sentence: WCAG 2.5.8's « inline »
              // exception does not apply, so it gets the 44 px target (G-1).
              className="inline-flex min-h-11 items-center font-semibold text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
            >
              {quote.providerName}
            </Link>
          ) : (
            <span className="font-semibold text-zinc-500 dark:text-zinc-400">
              Prestataire indisponible
            </span>
          )}
          {quote.headline && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{quote.headline}</p>
          )}
        </div>
        <p className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {quote.amountLabel}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {quote.statusLabel && (
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {quote.statusLabel}
          </span>
        )}
        {quote.verificationLabel && (
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            {quote.verificationLabel}
          </span>
        )}
        {quote.reputationLabel && (
          <span className="text-zinc-600 dark:text-zinc-400">{quote.reputationLabel}</span>
        )}
        {quote.distanceLabel && (
          <span className="text-zinc-500 dark:text-zinc-400">{quote.distanceLabel}</span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Durée estimée
          </dt>
          <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{quote.durationLabel}</dd>
        </div>
        {quote.proposedStartLabel && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Début proposé
            </dt>
            <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
              {quote.proposedStartLabel}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-3 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
        {quote.description}
      </p>

      {quote.isLive && (
        <div className="mt-4">
          {quote.blocker === 'not-acceptable' && (
            <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">
              Ce devis ne peut pas être accepté pour le moment.
            </p>
          )}
          {quote.blocker === 'deposit-too-small' && (
            <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">
              Montant trop faible pour un acompte.
            </p>
          )}
          <button
            type="button"
            onClick={onAccept}
            disabled={!acceptable || !canPay}
            className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Accepter ce devis
          </button>
        </div>
      )}
    </li>
  );
}
