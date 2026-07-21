import Link from 'next/link';

import type { DiscoveredProvider } from '@/lib/providers/discovery-types';

/**
 * One discovered provider (Phase 3.14a) — a Server Component (no `'use client'`).
 * The WHOLE card is a link to the existing public profile `/providers/{id}`
 * (3.13) — that is the strict boundary of 3.14a: search stops at the link, the
 * booking flow (3.13) is untouched.
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
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          {formatDistance(provider.distanceMeters)}
        </p>
      </Link>
    </li>
  );
}
