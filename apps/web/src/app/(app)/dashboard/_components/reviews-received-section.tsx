'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import type { ProviderReview } from '@/lib/reviews/types';

/**
 * « Avis reçus » — the provider reads their reviews and answers each one ONCE.
 *
 * ⚠️ THE ASYMMETRY THIS CLOSES IS WHY THE WHOLE CHANTIER IS DELICATE. An unhappy
 * client costs a tradesperson weeks of revenue in thirty seconds, and the
 * tradesperson is the side of the marketplace that has to be recruited first.
 * D-2 gives them exactly one turn, published where the review is read — enough
 * to rebalance, not enough to open a thread that degenerates.
 *
 * ⚠️ THE REPLY IS FINAL, AND THE COPY SAYS SO BEFORE IT IS SENT, NOT AFTER. It
 * cannot be edited and cannot be removed; the only thing that clears it is the
 * client retracting the review (D-3). Warning someone after the fact would be
 * the trap, not the safeguard — so the confirmation lives in the form, next to
 * the button.
 *
 * ⚠️ NO AVERAGE IS SHOWN HERE, DELIBERATELY. It arrives gated at three reviews
 * (D-4) and this section exists to answer individual reviews, not to grade the
 * provider on their own dashboard. The public profile is where the aggregate
 * belongs.
 *
 * Client island because the reply is a mutation with per-row state; everything
 * that needs formatting is resolved server-side and arrives in props.
 */

const RESPONSE_MAX = 2000;

const dateFmt = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long' });

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-hidden className="text-amber-500 dark:text-amber-400">
      {'★'.repeat(rating)}
      <span className="text-zinc-300 dark:text-zinc-600">{'☆'.repeat(5 - rating)}</span>
    </span>
  );
}

/** Mapping BY HTTP CODE ALONE (locked in 3.12b). Vouvoiement. */
function errorFor(status: number): string {
  switch (status) {
    case 400:
      return 'Votre réponse est vide ou trop longue.';
    case 401:
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    case 403:
      return 'Cet avis ne concerne pas votre profil.';
    case 404:
      return 'Cet avis a été retiré par son auteur.';
    case 409:
      return 'Vous avez déjà répondu à cet avis. Une réponse ne peut pas être modifiée.';
    case 429:
      return 'Vous avez publié plusieurs réponses coup sur coup. Réessayez dans un moment.';
    default:
      return 'Service momentanément indisponible. Veuillez réessayer plus tard.';
  }
}

function ReviewRow({ review }: { review: ProviderReview }) {
  const router = useRouter();
  const fieldId = useId();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    if (text.trim().length === 0) {
      setError('Veuillez écrire une réponse.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${review.id}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: text }),
      });
      if (!res.ok) {
        setError(errorFor(res.status));
        setPending(false);
        return;
      }
      // The server component is the source of truth — re-read rather than
      // patching local state, so what shows is what was stored.
      router.refresh();
    } catch {
      setError(errorFor(0));
      setPending(false);
    }
  }

  return (
    <li className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <Stars rating={review.rating} />
          <span className="sr-only">{review.rating} sur 5</span>{' '}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {review.authorDisplayName}
          </span>
        </p>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatDate(review.createdAtUtc)}
        </span>
      </div>

      {review.comment && (
        <p className="mt-2 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">
          {review.comment}
        </p>
      )}

      {review.providerResponse ? (
        <div className="mt-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Votre réponse
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
            {review.providerResponse}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-3">
          <label
            htmlFor={fieldId}
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Répondre publiquement
          </label>
          <textarea
            id={fieldId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={RESPONSE_MAX}
            rows={3}
            aria-describedby={`${fieldId}-hint`}
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white p-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
          {/* Said BEFORE sending, not after — see the file header. */}
          <p id={`${fieldId}-hint`} className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Vous ne pouvez répondre qu’une seule fois, et votre réponse ne pourra plus être
            modifiée. Elle s’affichera sous l’avis, sur votre profil public.
          </p>

          {error && (
            <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            {pending ? 'Envoi…' : 'Publier ma réponse'}
          </button>
        </form>
      )}
    </li>
  );
}

export function ReviewsReceivedSection({
  items,
  reviewCount,
}: {
  items: ProviderReview[];
  reviewCount: number;
}) {
  return (
    <section aria-labelledby="reviews-received-title">
      <h2
        id="reviews-received-title"
        className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        Avis reçus
      </h2>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Vous n’avez pas encore reçu d’avis.
        </div>
      ) : (
        <>
          <ul className="space-y-4">
            {items.map((review) => (
              <ReviewRow key={review.id} review={review} />
            ))}
          </ul>
          {reviewCount > items.length && (
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              Les {items.length} avis les plus récents sur {reviewCount}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
