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
    // Direction A (R1): a translucent card, NO `backdrop-filter` — the form
    // panel above is the screen's only frosted layer.
    <div className="rounded-2xl border border-on-accent/70 bg-surface p-5">
      <h2 className="text-sm font-medium text-text">
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
                className="flex min-h-11 items-center rounded-2xl border border-text/10 bg-bg/50 px-4 py-3 text-sm text-text transition motion-reduce:transition-none hover:border-accent/40 hover:bg-accent/5 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
