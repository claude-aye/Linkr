import { redirect } from 'next/navigation';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import { pickTranslation } from '@/lib/i18n/translations';
import type { components } from '@linkr/api-client';

// Reads the access cookie + live admin data — always rendered per request, never a build snapshot.
export const dynamic = 'force-dynamic';

/**
 * The demand map, for Linkr staff: which trade, in which sector, how many times
 * a search came back empty. A recruitment tool, nothing else — not a client
 * surface, not a public page, not product analytics.
 *
 * ⚠️ CONSUMED NATIVELY — no local mirror, no cast. `GET /admin/demand-signals`
 * declares a real envelope and annotates every property with a concrete type, so
 * nothing degrades to `Record<string, never>` (the nullable/JSONB debt of
 * CLAUDE.md §6 does not reach this endpoint). Contrast with the three neighbours
 * this codebase still works around: `discover` (envelope declared as a bare
 * array), `GET /service-categories` (`content: never`) and the provider request
 * items (nullable degradation).
 *
 * ⚠️ NOTHING IS AGGREGATED HERE, AND THAT IS DELIBERATE. The grouping happens in
 * SQL; the browser never receives an individual signal, so it could not group
 * them even if it wanted to. Do not "improve" this by fetching raw rows and
 * grouping client-side — that would put microsecond timestamps on the wire and
 * undo, in the read layer, the anonymity session 6 built into the schema.
 */
type DemandSector = components['schemas']['DemandSignalSummaryItemDto'];
type DemandSummary = components['schemas']['DemandSignalSummaryListDto'];

/**
 * Below this many signals across the whole map, the screen says so instead of
 * letting a handful of rows look like a trend.
 *
 * ⚠️ A DISPLAY THRESHOLD, AND NOTHING DEPENDS ON IT. The table is rendered
 * either way — the number is never hidden, only qualified. The figure itself is
 * a deliberately conservative guess, not a measurement: a single search in a
 * sector is one person on one day and cannot be told apart from a typo, so a map
 * this thin cannot carry a recruitment decision. Change it in one place when
 * real volume says otherwise.
 */
const ENOUGH_TO_DECIDE = 10;

const dayFmt = new Intl.DateTimeFormat('fr-CA', {
  dateStyle: 'long',
  // ⚠️ LOAD-BEARING. The API returns a bare `YYYY-MM-DD` (already truncated to
  // the UTC day). `new Date('2026-08-19')` parses as UTC midnight, so formatting
  // it in a server timezone west of UTC would render the PREVIOUS day. Pinning
  // the formatter to UTC keeps the rendered day equal to the day the API meant.
  timeZone: 'UTC',
});

function formatDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? isoDate : dayFmt.format(d);
}

function formatPeriod(first: string, last: string): string {
  return first === last
    ? `Le ${formatDay(first)}`
    : `Du ${formatDay(first)} au ${formatDay(last)}`;
}

/**
 * Coordinates are displayed raw — no reverse geocoding.
 *
 * « Rimouski » would read better than « 48,45 / -68,53 », and it is deliberately
 * not offered: resolving it means calling Nominatim (a fragile chain, ~1 req/s)
 * on every render, for reading comfort. The honest long-term fix is the
 * `locality` debt already tracked in CLAUDE.md §6 — the `common/geocoding/` seam
 * already RECEIVES the locality from Nominatim and persists it nowhere. This is
 * the second time that debt is the right fix.
 *
 * `toFixed(2)` restores the two decimals JSON drops (`-73.7` → `-73.70`): the
 * column is `numeric(_,2)` and every sector is a cell of the same size, so they
 * should all read the same width.
 */
function formatSector(lat: number, lng: number): string {
  return `${lat.toFixed(2)} / ${lng.toFixed(2)}`;
}

/**
 * A map link, not a map. Zero calls at render, zero dependency — a plain anchor
 * the admin may click.
 *
 * No `?mlat=&mlon=` marker on purpose: a pin claims a point, and this is a
 * ~1 km cell. Centring the view says « around here », which is what we know.
 */
function mapHref(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/#map=12/${lat.toFixed(2)}/${lng.toFixed(2)}`;
}

function StateCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
    </div>
  );
}

function SectorCard({ sector }: { sector: DemandSector }) {
  const trade = pickTranslation(sector.serviceCategoryNameTranslations);
  const coords = formatSector(sector.sectorLat, sector.sectorLng);

  return (
    <li className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3
          className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
          title={sector.serviceCategoryId}
        >
          {trade}
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          <span className="text-lg font-semibold text-zinc-900 tabular-nums dark:text-zinc-50">
            {sector.signalCount}
          </span>{' '}
          {sector.signalCount > 1 ? 'recherches sans résultat' : 'recherche sans résultat'}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="font-mono tabular-nums">{coords}</span>
        <a
          href={mapHref(sector.sectorLat, sector.sectorLng)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          Voir sur la carte
        </a>
      </div>

      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {formatPeriod(sector.firstSeenDate, sector.lastSeenDate)}
      </p>
    </li>
  );
}

export default async function AdminDemandSignalsPage() {
  // Session gate — same pattern as the verification console. A dead/expired
  // session resolves to null here → bounce to /login. `redirect` throws, so it
  // is called OUTSIDE the try/catch below.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const client = await getServerApiClient();

  let summary: DemandSummary | null = null;
  let forbidden = false;
  let failed = false;

  try {
    const { data, error, response } = await client.GET('/admin/demand-signals');
    if (response.status === 403) {
      // RBAC is the API's call alone: a logged-in non-admin lands here.
      forbidden = true;
    } else if (error || !response.ok || !data) {
      failed = true;
    } else {
      summary = data;
    }
  } catch {
    failed = true;
  }

  // ⚠️ « No fruitless search » and « the read failed » are DIFFERENT SCREENS.
  // The first is good news — every search so far found somebody. The second is
  // an outage. Collapsing them would report a breakage as a success, which is
  // the same mistake the empty state of `/recherche` exists to avoid.
  const isEmpty = summary !== null && summary.totalSignals === 0;
  const isThin =
    summary !== null && summary.totalSignals > 0 && summary.totalSignals < ENOUGH_TO_DECIDE;
  const capped = summary !== null && summary.items.length < summary.totalSectors;

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Carte de la demande
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Recherches restées sans résultat, regroupées par métier et par secteur. Sert à
            décider où recruter des prestataires.
          </p>
        </header>

        {forbidden ? (
          <StateCard title="Accès réservé aux administrateurs">
            Cette console est réservée au personnel Linkr (rôle ADMIN).
          </StateCard>
        ) : failed ? (
          <StateCard title="Chargement impossible">
            La carte de la demande n’a pas pu être récupérée. Veuillez réessayer plus tard.
          </StateCard>
        ) : isEmpty ? (
          <StateCard title="Aucune recherche infructueuse">
            Aucune recherche n’est encore repartie les mains vides — toutes celles enregistrées
            ont trouvé au moins un prestataire. Il n’y a rien à décider ici pour le moment.
          </StateCard>
        ) : (
          <>
            {isThin && (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
                <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Pas encore assez de données pour décider
                </h2>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                  {summary!.totalSignals} recherche
                  {summary!.totalSignals > 1 ? 's' : ''} sans résultat au total. À ce volume, une
                  poignée de recherches ne se distingue pas du hasard : lisez les chiffres
                  ci-dessous comme des exemples, pas comme une tendance.
                </p>
              </div>
            )}

            <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
              <span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {summary!.totalSignals}
                </span>{' '}
                recherche{summary!.totalSignals > 1 ? 's' : ''} sans résultat
              </span>
              <span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {summary!.totalSectors}
                </span>{' '}
                secteur{summary!.totalSectors > 1 ? 's' : ''} concerné
                {summary!.totalSectors > 1 ? 's' : ''}
              </span>
            </div>

            <ol className="space-y-4">
              {summary!.items.map((sector) => (
                <SectorCard
                  key={`${sector.serviceCategoryId}:${sector.sectorLat}:${sector.sectorLng}`}
                  sector={sector}
                />
              ))}
            </ol>

            {capped && (
              <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                Les {summary!.items.length} secteur
                {summary!.items.length > 1 ? 's' : ''} les plus actifs sur{' '}
                {summary!.totalSectors}.
              </p>
            )}

            <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-500">
              Les coordonnées désignent un secteur d’environ 1 km, jamais le lieu recherché, et
              les dates sont arrondies au jour. Aucune de ces lignes n’est rattachée à une
              personne.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
