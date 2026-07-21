import Link from 'next/link';

import type { components } from '@linkr/api-client';

/**
 * Geocode candidate list (Phase 3.14b-front) — a Server Component (no
 * `'use client'`). It closes the address → coordinates leg of the search:
 * `/geocode` returned a disambiguated list of `{ label, lat, lng }`, and each
 * candidate is a `next/link` back onto the SAME URL joint, this time writing
 * `?categoryId=&lat=&lng=` — which the page discriminator resolves to `discover`.
 * Clicking a candidate = validating it (symmetric with « Près de moi »: choosing
 * geolocation IS confirming). No client JS is needed, so this stays server-side.
 *
 * The contract for `/geocode` is generated CLEANLY (a proper `GeocodeResultDto`
 * envelope, unlike `discover` / `service-categories`), so the candidate type is
 * consumed NATIVELY from `schema.d.ts` — no local mirror, no cast.
 */
type GeocodeCandidate = components['schemas']['GeocodeCandidateDto'];

export function CandidateList({
  candidates,
  categoryId,
}: {
  candidates: GeocodeCandidate[];
  categoryId: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Choisissez l’adresse exacte&nbsp;:
      </h2>
      <ul className="mt-3 space-y-2">
        {candidates.map((candidate, index) => {
          // Coordinates are pushed RAW (`String(...)`, no rounding) — the same
          // decimals `discover` consumes and « Près de moi » already pushes. The
          // trade threads through untouched (symmetry ①).
          const params = new URLSearchParams({
            categoryId,
            lat: String(candidate.lat),
            lng: String(candidate.lng),
          });
          return (
            <li key={`${candidate.lat},${candidate.lng},${index}`}>
              <Link
                href={`/recherche?${params.toString()}`}
                className="block rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {candidate.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
