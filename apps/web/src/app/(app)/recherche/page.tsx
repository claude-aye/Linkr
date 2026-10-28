import { redirect } from 'next/navigation';

import type { components } from '@linkr/api-client';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import { tradesOfferedAtLaunch } from '@/lib/catalog/launch-scope';
import { pickTranslation } from '@/lib/i18n/translations';
import { buildProviderFeatureCollection } from '@/lib/map/map-data';
import type { CategoryOption } from '@/lib/providers/discovery-types';

import { CandidateList } from './_components/candidate-list';
import { DemandSignalRecorder } from './_components/demand-signal-recorder';
import { NoResults } from './_components/no-results';
import { ProviderCard } from './_components/provider-card';
import { ResultsMapSlot } from './_components/results-map-slot';
import { ResultsSyncProvider, SyncedResult } from './_components/results-sync';
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

/**
 * Direction A (R1) — one card surface for every state of this screen: a
 * translucent `bg-surface` with a light edge, the screen's single radius
 * (`rounded-2xl`), and NO `backdrop-filter`. The form panel is the only frosted
 * layer of the screen; cards sit in a list that scrolls, where a blur costs
 * every frame on a phone.
 *
 * The light edge reads `--color-on-accent` (ivory in light, near-black in dark):
 * the socle has no dedicated edge token yet, and this is the only token that is
 * near-white in the light theme and still sits quietly on the dark one.
 */
function StateCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-on-accent/70 bg-surface p-8 text-center">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p className="mt-2 text-sm text-text-muted">{children}</p>
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
 * Chantier H adds NO state and NO request — it makes two existing states speak:
 *   - State 0 WITH a trade already chosen (how every hub tile arrives here) now
 *     says what is still missing instead of rendering a silent form, so a search
 *     whose location is unknown degrades EXPLICITLY rather than dead-ending.
 *   - discover with `total === 0` now distinguishes « nobody practises here »
 *     from « nobody is verified yet » — see `NoResults`.
 * Both read the catalog the trade selector ALREADY loads: zero extra call.
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
  // ⚠️ TWO SETS OUT OF ONE FETCH, AND CONFLATING THEM IS THE BUG THIS GUARDS
  // AGAINST. `categoryOptions` is what the selector OFFERS — narrowed to the
  // launch scope (informal trades only, see `lib/catalog/launch-scope.ts`).
  // `categories` below stays the FULL catalog because it is the LOOKUP set: a
  // regulated `?categoryId=` arriving from a bookmark or a shared link must
  // still resolve to its name and its regulation level. Narrowing this one too
  // would strand that link on the « unknown trade » branch of `NoResults` and
  // silently delete the honest regulated empty state chantier H shipped.
  const categoryOptions = tradesOfferedAtLaunch(categories)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ id: c.id, label: pickTranslation(c.nameTranslations) }));

  // --- Search params: the decoupling joint (the URL drives the search) --------
  const sp = await searchParams;
  const categoryId = firstParam(sp.categoryId);
  const validCategoryId = categoryId && UUID_RE.test(categoryId) ? categoryId : null;
  const lat = parseCoord(firstParam(sp.lat));
  const lng = parseCoord(firstParam(sp.lng));
  const q = firstParam(sp.q)?.trim();

  // The chosen trade, resolved against the FULL catalog fetched above (never the
  // offered subset — see the note there) — NO second request. It carries the two
  // things the H states need: a name to show (never a UUID) and the regulation
  // level, which is the ONLY signal able to explain a zero result — `discover`
  // returns the same empty envelope whether nobody practises the trade or every
  // practitioner is still PENDING.
  // Null when the id matches nothing, or when the catalog read failed above;
  // both degrade to trade-less copy rather than inventing a label.
  const selectedCategory =
    categories.find((category) => category.id === validCategoryId) ?? null;
  const selectedTradeLabel = selectedCategory
    ? pickTranslation(selectedCategory.nameTranslations)
    : null;

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
  let result: components['schemas']['DiscoveredProviderListDto'] | null = null;
  let searchFailed = false;
  if (discoverQuery) {
    try {
      const { data, error, response } = await client.GET('/service-providers/discover', {
        params: { query: discoverQuery },
      });
      if (!error && response.ok && data) {
        // Typed natively since R2a (`DiscoveredProviderListDto`): no mirror, no cast.
        result = data;
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

  const intro = (
    <p className="mt-2 text-base text-text-muted">
      Choisissez un métier, puis trouvez les prestataires près de vous.
    </p>
  );
  const form = (embedded: boolean) => (
    <SearchForm
      categories={categoryOptions}
      selectedCategoryId={validCategoryId ?? undefined}
      selectedAddress={q}
      embedded={embedded}
    />
  );

  // --- R2b: results WITH a map ------------------------------------------------
  // ⚠️ The map mounts ONLY here: a valid discover search that returned at least
  // one provider. Every other state (State 0, State 0 with a trade, geocode
  // candidates, geolocation refusal, geocode or discover failure, `total === 0`)
  // keeps the R1 layout below and never loads `maplibre-gl`.
  if (discoverQuery && !searchFailed && providers.length > 0) {
    // Approximate locations only (cell centres, CLAUDE.md §13.1 nº 22).
    const mapFeatures = buildProviderFeatureCollection(providers);
    return (
      <main className="relative flex flex-1 flex-col bg-bg lg:block lg:min-h-[calc(100dvh-var(--shell-header-h)-var(--trial-banner-h))]">
        <ResultsSyncProvider>
          {/* Desktop: full-bleed map behind the side panel. Phone: map on top,
              a fixed panel below it (no drag gesture in V1). */}
          <div className="h-[42svh] w-full lg:absolute lg:inset-0 lg:h-auto">
            <ResultsMapSlot
              providers={mapFeatures}
              searched={[discoverQuery.lng, discoverQuery.lat]}
            />
          </div>

          {/* The screen's ONE frosted layer: the form inside is `embedded`, so it
              drops its own. The cards below stay blur-free (they scroll). */}
          <section
            aria-label="Recherche et résultats"
            className="relative border-t border-on-accent/70 bg-surface p-5 shadow-xl shadow-accent/10 backdrop-blur-xl sm:p-6 lg:absolute lg:top-6 lg:bottom-6 lg:left-6 lg:w-md lg:overflow-y-auto lg:rounded-2xl lg:border"
          >
            <header className="mb-5">
              <h1 className="font-script text-4xl leading-tight text-accent">
                Rechercher un prestataire
              </h1>
              {intro}
            </header>

            {form(true)}

            <h2 className="mt-6 text-sm font-medium text-text">
              {providers.length === 1
                ? '1 prestataire trouvé'
                : `${providers.length} prestataires trouvés`}
            </h2>
            {/* Phone: the list scrolls inside the fixed panel. Desktop: the
                whole panel scrolls. The 4px inner padding keeps the active
                highlight ring (ring + offset) from being clipped. */}
            <ul className="-mx-1 mt-3 max-h-[60svh] space-y-4 overflow-y-auto p-1 lg:max-h-none lg:overflow-visible">
              {providers.map((provider) => (
                <SyncedResult key={provider.id} id={provider.id}>
                  {/* Same card, same link (`?lat=&lng=` threaded, voie Ⓐ). */}
                  <ProviderCard
                    provider={provider}
                    lat={discoverQuery.lat}
                    lng={discoverQuery.lng}
                  />
                </SyncedResult>
              ))}
            </ul>
          </section>
        </ResultsSyncProvider>
      </main>
    );
  }

  return (
    // Direction A (R1): a very soft beige → bordeaux ground with two blurred
    // bordeaux halos behind the content. `isolate` keeps the decorative layer's
    // negative z-index inside this screen; `overflow-hidden` keeps the halos
    // from widening the page on a phone.
    <main className="relative isolate flex flex-1 justify-center overflow-hidden bg-linear-to-b from-bg via-bg to-accent/15 p-6">
      {/* Decoration only: no content, no pointer events, hidden from assistive
          tech. Plain CSS (`filter: blur`), no image. This is NOT a
          `backdrop-filter` — the form panel remains the screen's only one. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -right-32 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute top-1/2 -left-48 h-112 w-md rounded-full bg-accent/10 blur-3xl" />
      </div>

      <section className="w-full max-w-3xl">
        <header className="mb-8">
          {/* Parisienne (`font-script`) on this display title ONLY — never on
              body text, labels or buttons (CLAUDE.md §13.1 nº 20). */}
          <h1 className="font-script text-5xl leading-tight text-accent sm:text-6xl">
            Rechercher un prestataire
          </h1>
          {intro}
        </header>

        {form(false)}

        {/* Discriminator: discover (failure or zero — results with providers
            took the map layout above) → geocode candidates → State 0 (form
            alone, no results section). */}
        {discoverQuery ? (
          <div className="mt-8">
            {searchFailed ? (
              <StateCard title="Recherche impossible">
                La recherche n’a pas pu aboutir pour le moment. Veuillez réessayer plus tard.
              </StateCard>
            ) : (
              // Chantier H — a product surface, not a bare « aucun résultat ». It
              // names the trade and explains WHY zero is possible, which differs
              // by regulation level. See the component header.
              <>
                <NoResults
                  tradeLabel={selectedTradeLabel}
                  regulationLevel={selectedCategory?.regulationLevel ?? null}
                />
                {/* Chantier H, tranche 2a — records the unmet demand. Renders
                    nothing; mounted ONLY here, so a failed `discover` (the
                    branch above) can never be logged as an absence of supply.
                    The write is a POST from the client precisely so that it is
                    not a side effect of this render — see the component. */}
                <DemandSignalRecorder
                  categoryId={discoverQuery.categoryId}
                  lat={discoverQuery.lat}
                  lng={discoverQuery.lng}
                />
              </>
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
        ) : validCategoryId ? (
          // Chantier H — STATE 0 reached WITH a trade already chosen, i.e. how
          // every hub tile lands here: half the search is done and nothing said
          // so. A search whose location is unknown must degrade EXPLICITLY, not
          // dead-end on a silent form (project invariant: degrade, and say so).
          // With no trade there is nothing to report, so this stays null and the
          // page is exactly the State 0 of 3.14a.
          <div className="mt-8">
            <StateCard title={`Vous cherchez : ${selectedTradeLabel ?? 'ce métier'}`}>
              Indiquez où vous êtes pour voir les prestataires disponibles&nbsp;:
              utilisez «&nbsp;Près de moi&nbsp;» ou saisissez une adresse ci-dessus.
            </StateCard>
          </div>
        ) : null}
      </section>
    </main>
  );
}
