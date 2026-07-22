import { redirect } from 'next/navigation';

import type { components } from '@linkr/api-client';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import { pickTranslation } from '@/lib/i18n/translations';
import type {
  CategoryOption,
  DiscoveredProviderList,
} from '@/lib/providers/discovery-types';

import { CandidateList } from './_components/candidate-list';
import { ProviderCard } from './_components/provider-card';
import { SearchForm } from './_components/search-form';

// `/geocode` ships a CLEAN generated envelope (`GeocodeResultDto`), so the
// candidate type is read NATIVELY — no local mirror, unlike discover.
type GeocodeCandidate = components['schemas']['GeocodeCandidateDto'];

// Reads the access cookie + live discovery data — always rendered per request.
export const dynamic = 'force-dynamic';

/** Loose UUID shape check — a malformed id can never be a valid categoryId. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseCoord(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function StateCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
    </div>
  );
}

/**
 * `/recherche` — geo discovery (Phase 3.14a) + address geocoding (3.14b-front).
 * Voie Ⓒ′: the client form writes onto the URL, this Server Component reads
 * `searchParams` + the httpOnly cookie and calls the API. The URL is the
 * decoupling joint. Server-side state machine, in priority order:
 *
 *   lat + lng + categoryId valid  → discover (provider cards)      [3.14a]
 *   else q + categoryId valid     → geocode  (address candidates)  [3.14b]
 *   else                          → form only (State 0)
 *
 * Strict boundary: the search stops at the link to `/providers/{id}` — the 3.13
 * booking flow (and its fixed `serviceLocation` placeholder) is untouched (3.14c).
 */
export default async function RecherchePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Session gate — `redirect` throws, so it runs OUTSIDE any try/catch. The page
  // is PRIVATE (under `(app)`): an expired session must not render.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const client = await getServerApiClient();

  // --- Trades (server fetch; the client form never fetches authed itself) -----
  // `GET /service-categories` ships no response schema (`content: never`) and
  // returns a bare array — cast through the minimal local `CategoryOption[]`.
  let categories: CategoryOption[] = [];
  try {
    const { data, error, response } = await client.GET('/service-categories');
    if (!error && response.ok && Array.isArray(data)) {
      categories = data as unknown as CategoryOption[];
    }
  } catch {
    categories = [];
  }
  const categoryOptions = [...categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ id: c.id, label: pickTranslation(c.nameTranslations) }));

  // --- Search params: the decoupling joint (the URL drives the search) --------
  const sp = await searchParams;
  const categoryId = firstParam(sp.categoryId);
  const validCategoryId = categoryId && UUID_RE.test(categoryId) ? categoryId : null;
  const lat = parseCoord(firstParam(sp.lat));
  const lng = parseCoord(firstParam(sp.lng));
  const q = firstParam(sp.q)?.trim();

  // Discover wins when lat+lng+categoryId are present AND valid; the ternary
  // narrows lat/lng to `number` and categoryId to `string` for the call.
  const discoverQuery =
    validCategoryId && lat !== null && lng !== null
      ? { lat, lng, categoryId: validCategoryId, page: 1, limit: 50 }
      : null;

  // Geocode is the fallback: a non-empty address + a valid trade, and NO valid
  // discover search taking precedence. Whitespace-only `q` degrades to State 0
  // (never a pointless 400 — the backend rejects a blank `q`).
  const geocodeQuery =
    !discoverQuery && validCategoryId && q ? { q, limit: 5 } : null;

  // --- Discovery (only on a valid coordinate search) -------------------------
  let result: DiscoveredProviderList | null = null;
  let searchFailed = false;
  if (discoverQuery) {
    try {
      const { data, error, response } = await client.GET('/service-providers/discover', {
        params: { query: discoverQuery },
      });
      if (!error && response.ok && data) {
        // The contract annotates this as a BARE array, but the runtime returns
        // the pagination envelope — cast through the local mirror (tracked debt,
        // CLAUDE.md « fix contrat discover »).
        result = data as unknown as DiscoveredProviderList;
      } else {
        searchFailed = true;
      }
    } catch {
      searchFailed = true;
    }
  }

  const providers = result?.items ?? [];

  // --- Geocode (only when the address branch is active) ----------------------
  // `GET /geocode` is CLEANLY typed (proper `GeocodeResultDto` envelope), so
  // `data.candidates` is consumed natively — no cast, no mirror.
  let candidates: GeocodeCandidate[] = [];
  let geocodeFailed = false;
  if (geocodeQuery) {
    try {
      const { data, error, response } = await client.GET('/geocode', {
        params: { query: geocodeQuery },
      });
      if (!error && response.ok && data && Array.isArray(data.candidates)) {
        candidates = data.candidates;
      } else {
        // 502 (Nominatim unreachable) and any other non-2xx land here.
        geocodeFailed = true;
      }
    } catch {
      geocodeFailed = true;
    }
  }

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Rechercher un prestataire
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Choisissez un métier, puis trouvez les prestataires près de vous.
          </p>
        </header>

        <SearchForm
          categories={categoryOptions}
          selectedCategoryId={validCategoryId ?? undefined}
          selectedAddress={q}
        />

        {/* Discriminator: discover cards → geocode candidates → State 0 (form
            alone, no results section). */}
        {discoverQuery ? (
          <div className="mt-8">
            {searchFailed ? (
              <StateCard title="Recherche impossible">
                La recherche n’a pas pu aboutir pour le moment. Veuillez réessayer plus tard.
              </StateCard>
            ) : providers.length === 0 ? (
              <StateCard title="Aucun prestataire proche">
                Aucun prestataire proche pour ce métier. Essayez un autre métier ou réessayez.
              </StateCard>
            ) : (
              <ul className="space-y-4">
                {providers.map((provider) => (
                  // `discoverQuery` is non-null here → its lat/lng are the finite
                  // searched coords; thread them onward (voie Ⓐ, Phase 3.14c-1).
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    lat={discoverQuery.lat}
                    lng={discoverQuery.lng}
                  />
                ))}
              </ul>
            )}
          </div>
        ) : geocodeQuery && validCategoryId ? (
          <div className="mt-8">
            {geocodeFailed ? (
              <StateCard title="Recherche d’adresse impossible">
                La recherche d’adresse est impossible pour le moment. Veuillez réessayer plus
                tard.
              </StateCard>
            ) : candidates.length === 0 ? (
              <StateCard title="Aucune adresse trouvée">
                Aucune adresse trouvée. Précisez votre recherche.
              </StateCard>
            ) : (
              <CandidateList candidates={candidates} categoryId={validCategoryId} />
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
