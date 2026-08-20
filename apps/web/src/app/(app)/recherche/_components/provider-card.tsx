import Link from 'next/link';

import type { DiscoveredProvider } from '@/lib/providers/discovery-types';

/**
 * One discovered provider (Phase 3.14a) — a Server Component (no `'use client'`).
 * The WHOLE card is a link to the existing public profile `/providers/{id}`
 * (3.13) — that is the strict boundary of 3.14a: search stops at the link, the
 * booking flow (3.13) is untouched.
 *
 * D tranche 3 adds the reputation line. It is INFORMATION, NEVER A RANKING KEY:
 * the list stays ordered by proximity alone, because ranking by reputation
 * compounds — whoever has reviews is seen, therefore booked, therefore
 * accumulates reviews — and in a market where every tradesperson is recruited by
 * hand that condemns each new recruit to invisibility. The accepted cost, worth
 * naming: a client looking at two equally close providers, one rated and one
 * not, gets no help telling them apart.
 */

const kmFmt = new Intl.NumberFormat('fr-CA', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** « à 460 m » under 1 km; « à 1,2 km » otherwise (fr-CA, one decimal). */
function formatDistance(meters: number): string {
  if (meters < 1000) return `à ${Math.round(meters)} m`;
  return `à ${kmFmt.format(meters / 1000)} km`;
}

/**
 * fr-CA renders 4.33 as « 4,33 » — a decimal point would read as English.
 *
 * Mirrored from the profile's reviews block rather than shared: that one is a
 * local const in its own tree, and exporting it would grow the tracked « shared
 * status/format helper » debt instead of leaving it where it is. Same config,
 * so the two surfaces print the same number the same way.
 */
const ratingFmt = new Intl.NumberFormat('fr-CA', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

/**
 * The reputation line on a result card — three states, and the first one is the
 * one that is easy to get wrong.
 *
 * ⚠️ ZERO REVIEWS RENDERS NOTHING. Not « 0 avis », not greyed-out stars, not a
 * reserved blank: the component returns null. Silence is the correct rendering,
 * the same principle as the silence on `GEOCODED` — a marker that means
 * something only by its ABSENCE. Every provider on this platform starts at zero,
 * and stamping « 0 avis » on each of them would read as a defect rather than as
 * a beginning. It is also what a FAILED rating read degrades to, so a broken
 * aggregate costs the reputation line and never the search result.
 *
 * ⚠️ THE THRESHOLD IS NEVER RE-DERIVED HERE. `averageRating` arrives already
 * gated: null below three live reviews (D-4), decided in SQL by the same
 * fragment the profile reads. Testing `reviewCount >= 3` in this file instead
 * would be a second copy of the rule, free to drift — and drift here means a
 * card showing an average the profile refuses to show. Read the null, do not
 * recompute the reason for it.
 */
function Reputation({
  reviewCount,
  averageRating,
}: {
  reviewCount: number;
  averageRating: number | null;
}) {
  if (reviewCount === 0) return null;

  // « avis » is invariable in French: 1 avis, 2 avis. Nothing to inflect.

  // The separator from the distance lives INSIDE this component, so it cannot
  // be left dangling on a card that shows no reputation at all.
  const separator = (
    <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
      ·
    </span>
  );

  // Below the threshold the API sends no average, so the count travels alone.
  // It is a real signal — someone has been here before — without pretending a
  // sample of one or two is a rating.
  if (averageRating === null) {
    return (
      <>
        {separator}
        <span className="text-zinc-500 dark:text-zinc-400">{reviewCount} avis</span>
      </>
    );
  }

  return (
    <>
      {separator}
      <span className="text-zinc-600 dark:text-zinc-300">
        <span aria-hidden className="text-amber-500 dark:text-amber-400">
          ★
        </span>{' '}
        <span className="font-medium">{ratingFmt.format(averageRating)}</span> sur 5 ·{' '}
        {reviewCount} avis
      </span>
    </>
  );
}

export function ProviderCard({
  provider,
  lat,
  lng,
}: {
  provider: DiscoveredProvider;
  /**
   * The current search coordinate. Threaded onto the profile link (voie Ⓐ,
   * Phase 3.14c-1) so it can travel result-card → profile → booking form and
   * reach `POST /service-requests` as the REAL `serviceLocation`. When absent
   * (should not happen in the discover flow), the profile link stays bare.
   */
  lat?: number;
  lng?: number;
}) {
  // `displayName` is nullable at the contract level → sober fallback, no invented
  // field. `headline` is dropped entirely when null (never render « null »).
  const name = provider.displayName ?? 'Prestataire';

  // Badge Ⓐ: show a POSITIVE signal only on VERIFIED (Hard Trust). Show NOTHING
  // on NOT_REQUIRED — the silence is neutral; « non vérifié » on an informal
  // trade would be a false negative signal. The backend already filters out
  // everything but VERIFIED / NOT_REQUIRED, so no other state can appear here.
  const isVerified = provider.categoryVerificationStatus === 'VERIFIED';

  const href =
    lat != null && lng != null
      ? `/providers/${provider.id}?lat=${lat}&lng=${lng}`
      : `/providers/${provider.id}`;

  return (
    <li>
      <Link
        href={href}
        className="block rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{name}</h3>
            {provider.headline && (
              <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">
                {provider.headline}
              </p>
            )}
          </div>
          {isVerified && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              ✓ Licence vérifiée
            </span>
          )}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{formatDistance(provider.distanceMeters)}</span>
          {/* Rendered by the component, not by a condition here: a provider with
              no reviews self-nulls, so there is no `if` on reputation in the
              card and no separator left dangling. */}
          <Reputation
            reviewCount={provider.reviewCount}
            averageRating={provider.averageRating}
          />
        </p>
      </Link>
    </li>
  );
}
