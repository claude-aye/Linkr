'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

import type { MyReview } from '@/lib/reviews/types';

/**
 * The client's review of one finished job: write it, see it, retract it.
 *
 * The ONLY `'use client'` surface of the requests page — the page and the card
 * stay Server Components, and this island is mounted with everything it needs
 * already resolved (the existing review, or null).
 *
 * ⚠️ IT IS RENDERED ONLY FOR A REQUEST THAT REACHED COMPLETED — the card
 * decides that, on `completedAtUtc`, NEVER on `status === 'COMPLETED'`. A
 * request does not stay in COMPLETED: the auto-release cron moves it to PAID
 * after 72 hours, and gating the UI on the current status would make the form
 * disappear from under a client who waited three days, on the one screen where
 * they would look for it.
 *
 * ⚠️ MAPPING BY HTTP CODE ALONE (locked in 3.12b) — the body is never parsed to
 * pick a message. Vouvoiement throughout.
 */

const RATING_VALUES = [1, 2, 3, 4, 5] as const;
const COMMENT_MAX = 2000;

/** Full / empty stars. Decorative — the accessible text is next to it. */
function Stars({ rating }: { rating: number }) {
  return (
    <span aria-hidden className="text-amber-500 dark:text-amber-400">
      {'★'.repeat(rating)}
      <span className="text-zinc-300 dark:text-zinc-600">{'☆'.repeat(5 - rating)}</span>
    </span>
  );
}

function writeErrorFor(status: number): string {
  switch (status) {
    case 400:
      return 'Certains champs sont invalides. Vérifiez la note et le commentaire.';
    case 401:
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    case 403:
      return 'Vous ne pouvez pas évaluer cette demande.';
    case 404:
      return 'Cette demande n’est plus accessible.';
    case 409:
      return 'Cette demande a déjà un avis, ou le travail n’est pas encore terminé.';
    case 429:
      return 'Vous avez publié plusieurs avis coup sur coup. Réessayez dans un moment.';
    default:
      return 'Service momentanément indisponible. Veuillez réessayer plus tard.';
  }
}

export function ReviewSection({
  serviceRequestId,
  review,
}: {
  serviceRequestId: string;
  review: MyReview | null;
}) {
  const router = useRouter();
  const ratingName = useId();
  const commentId = useId();

  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Already reviewed: show it, offer the retraction ──────────────────────
  if (review) {
    return (
      <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">Votre avis :</span>{' '}
            <Stars rating={review.rating} />{' '}
            <span className="text-zinc-500 dark:text-zinc-400">{review.rating} sur 5</span>
          </p>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="min-h-11 rounded-lg px-3 text-sm font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            Retirer mon avis
          </button>
        </div>

        {review.comment && (
          <p className="mt-2 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">
            {review.comment}
          </p>
        )}

        {/* The provider's reply (D-2). The client READS it and never answers it
            — that is the decision, not a missing feature: one reply rebalances
            the asymmetry without opening a thread that degenerates. Retracting
            the review takes the reply with it (D-3), which the confirmation
            dialog below says in as many words. */}
        {review.providerResponse && (
          <div className="mt-3 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Réponse du prestataire
            </p>
            <p className="mt-1 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">
              {review.providerResponse}
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {/* Retracting is not destructive in the money sense, but it removes
            something the client wrote and that the provider may have read — and
            it is invisible once done. A confirmation is proportionate friction;
            the shared dialog gives us the focus trap and Escape for free. */}
        <ConfirmDialog
          isOpen={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Retirer votre avis ?"
          confirmLabel="Retirer"
          onConfirm={async () => {
            setError(null);
            const response = await fetch(`/api/reviews/${review.id}`, { method: 'DELETE' });
            if (!response.ok) {
              // The dialog shows a rejected Error's message verbatim.
              throw new Error(
                response.status === 404
                  ? 'Cet avis a déjà été retiré.'
                  : 'Service momentanément indisponible. Veuillez réessayer plus tard.',
              );
            }
            router.refresh();
          }}
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Votre avis ne sera plus visible sur le profil du prestataire, et il cessera de
            compter dans sa note. La réponse du prestataire, s’il en a écrit une, disparaîtra
            avec lui. Vous pourrez ensuite en écrire un nouveau pour cette demande.
          </p>
        </ConfirmDialog>
      </div>
    );
  }

  // ── Not reviewed yet: the form ───────────────────────────────────────────
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    if (rating === null) {
      setError('Veuillez choisir une note.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceRequestId, rating, comment }),
      });
      if (!response.ok) {
        setError(writeErrorFor(response.status));
        setPending(false);
        return;
      }
      // The server component is the source of truth — re-read rather than
      // patching local state, so what shows is what was stored.
      router.refresh();
    } catch {
      setError(writeErrorFor(0));
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800"
    >
      <fieldset>
        <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Comment s’est passé ce service&nbsp;?
        </legend>

        {/* Radios rather than clickable stars: keyboard and screen-reader
            support come from the platform, and each value is nameable. */}
        <div className="mt-2 flex flex-wrap gap-1">
          {RATING_VALUES.map((value) => (
            <label
              key={value}
              className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm ${
                rating === value
                  ? 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-200'
                  : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400'
              }`}
            >
              <input
                type="radio"
                name={ratingName}
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="sr-only"
              />
              <span aria-hidden>{'★'.repeat(value)}</span>
              <span className="sr-only">
                {value} étoile{value > 1 ? 's' : ''} sur 5
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label
        htmlFor={commentId}
        className="mt-3 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        Commentaire <span className="font-normal text-zinc-500">(facultatif)</span>
      </label>
      <textarea
        id={commentId}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={COMMENT_MAX}
        rows={3}
        className="mt-1 w-full rounded-lg border border-zinc-200 bg-white p-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-3 min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
      >
        {pending ? 'Envoi…' : 'Publier mon avis'}
      </button>
    </form>
  );
}
