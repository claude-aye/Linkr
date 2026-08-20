import type { ProviderReview, ProviderReviewList } from '@/lib/reviews/types';

/**
 * A provider's reviews on their profile — Server Component, no interactivity,
 * no `'use client'`.
 *
 * ⚠️ THE AVERAGE IS NOT COMPUTED HERE, AND MUST NEVER BE. `averageRating`
 * arrives ALREADY GATED by the API: it is `null` below three live reviews
 * (D-4), decided in SQL so the number never leaves the database under the
 * threshold. Deriving one from `items` would both defeat that rule and lie the
 * moment the 50-item cap bites — the same trap as recomputing an unread badge
 * from a truncated page.
 *
 * The count is always shown; the AVERAGE is what stays silent. « Not yet enough
 * to say » is a sentence this platform already uses twice (the silence on
 * GEOCODED, the demand map's banner): it never claims to know what it does not.
 */

const dateFmt = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long' });

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

/** fr-CA renders 4.33 as « 4,33 » — a decimal point would read as English. */
const ratingFmt = new Intl.NumberFormat('fr-CA', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-hidden className="text-amber-500 dark:text-amber-400">
      {'★'.repeat(rating)}
      <span className="text-zinc-300 dark:text-zinc-600">{'☆'.repeat(5 - rating)}</span>
    </span>
  );
}

function ReviewRow({ review }: { review: ProviderReview }) {
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
    </li>
  );
}

export function ReviewsBlock({ reviews }: { reviews: ProviderReviewList | null }) {
  return (
    <section aria-labelledby="reviews-title" className="mt-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="reviews-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Avis
        </h2>

        {/* Shown ONLY when the API sent one — i.e. at three reviews or more. */}
        {reviews && reviews.averageRating !== null && (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-semibold">{ratingFmt.format(reviews.averageRating)}</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {' '}
              sur 5 · {reviews.reviewCount} avis
            </span>
          </p>
        )}
      </div>

      {reviews === null ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Les avis n’ont pas pu être chargés.
        </div>
      ) : reviews.reviewCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Ce prestataire n’a pas encore reçu d’avis.
        </div>
      ) : (
        <>
          {/* ⚠️ THE THRESHOLD, ON SCREEN. Below three reviews the API sends no
              average, and this line says WHY rather than leaving a blank where a
              number would go. It states the RULE — never a promise, and never a
              count of what is missing. */}
          {reviews.averageRating === null && (
            <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
              Pas encore assez d’avis pour afficher une note moyenne — il en faut au
              moins trois.
            </p>
          )}

          <ul className="space-y-4">
            {reviews.items.map((review) => (
              <ReviewRow key={review.id} review={review} />
            ))}
          </ul>

          {reviews.reviewCount > reviews.items.length && (
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              Les {reviews.items.length} avis les plus récents sur {reviews.reviewCount}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
