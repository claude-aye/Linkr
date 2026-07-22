import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import { pickTranslation } from '@/lib/i18n/translations';
import type { ProviderCatalogItem, ProviderProfile } from '@/lib/providers/types';

// Reads the access cookie + live provider data — always rendered per request.
export const dynamic = 'force-dynamic';

/** Parses a coord param; null when absent, empty, or non-finite. */
function parseCoord(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * « &lat=…&lng=… » when BOTH coords are valid, else « » (a bare link). This is
 * maillon 2 of the coord thread (Phase 3.14c-1): the searched coordinate rode
 * the URL from the result card; re-emit it onto the « Demander » CTA so it
 * reaches the booking form. A bare suffix lets the form fall back to the
 * placeholder (direct-profile entry / shared link) without blocking the submit.
 */
function coordsSuffix(lat: string | undefined, lng: string | undefined): string {
  const latN = parseCoord(lat);
  const lngN = parseCoord(lng);
  if (latN === null || lngN === null) return '';
  return `&lat=${latN}&lng=${lngN}`;
}

/**
 * Formats a price to the fr-CA locale (e.g. « 85,00 $ »). `priceAmount` is a
 * runtime number here (the API returns it as a number, not a decimal string).
 * Degrades to the raw pair on an unknown ISO 4217 code rather than crash.
 */
function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** « Coiffure · Coloration » — the trade is kept in context (a provider may
    practise several trades), then the specific service. */
function serviceLabels(item: ProviderCatalogItem): { trade: string; service: string } {
  return {
    trade: pickTranslation(item.serviceCategoryNameTranslations),
    service: pickTranslation(item.serviceItemNameTranslations),
  };
}

function StateCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      {children}
    </div>
  );
}

/**
 * One bookable service. FLAT/HOURLY with a non-null price shows a « Demander »
 * CTA carrying ONLY the two ids (providerId + serviceId) — never the price,
 * currency, category or labels: `estimatedAmount` is free-form on the backend
 * (no check against the service price), so a tampered URL would let a client
 * book at $1. The booking form (task 3) re-reads the API to derive money.
 *
 * QUOTE_ONLY — or any null price (defence in depth: we test the amount, not
 * just the pricing model) — shows « Sur devis » and NO CTA: a DIRECT_BOOKING
 * with a null amount is uninterpretable for the provider (3.12b guard: null
 * amount = un-acceptable), i.e. a dead-on-arrival request. The real quote path
 * is the Quotes domain (3.9), out of scope here.
 */
function ServiceRow({
  providerId,
  item,
  coordsQuery,
}: {
  providerId: string;
  item: ProviderCatalogItem;
  /** « &lat=…&lng=… » or « » — appended to the « Demander » link (Phase 3.14c-1). */
  coordsQuery: string;
}) {
  const { trade, service } = serviceLabels(item);
  const bookable = item.pricingModel !== 'QUOTE_ONLY' && item.priceAmount != null;

  return (
    <li className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {trade}
          </p>
          <h3 className="mt-0.5 font-semibold text-zinc-900 dark:text-zinc-50">{service}</h3>
        </div>
        <div className="text-right">
          {bookable ? (
            <p className="font-semibold text-zinc-900 dark:text-zinc-50">
              {formatMoney(item.priceAmount as number, item.priceCurrency)}
              {item.pricingModel === 'HOURLY' && (
                <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
                  {' '}
                  / h
                </span>
              )}
            </p>
          ) : (
            <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              Sur devis
            </span>
          )}
        </div>
      </div>

      {item.estimatedDurationMinutes != null && (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Durée estimée : {item.estimatedDurationMinutes} min
        </p>
      )}

      {item.descriptionOverride && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{item.descriptionOverride}</p>
      )}

      {bookable && (
        <div className="mt-4">
          <Link
            href={`/requests/new?providerId=${providerId}&serviceId=${item.id}${coordsQuery}`}
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500"
          >
            Demander
          </Link>
        </div>
      )}
    </li>
  );
}

export default async function ProviderProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lat?: string; lng?: string }>;
}) {
  // The page is PRIVATE even though the API endpoints are `@Public()` — without
  // this gate an expired session could still render (a public endpoint returns
  // 200 regardless). `redirect` throws, so it stays outside any try/catch.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { id } = await params;
  // The searched coordinate rides the URL from the result card (voie Ⓐ,
  // Phase 3.14c-1); re-emit it onto each « Demander » CTA so it reaches the
  // booking form. Empty suffix (no/invalid coords) → the CTA stays bare.
  const { lat, lng } = await searchParams;
  const coordsQuery = coordsSuffix(lat, lng);

  const client = await getServerApiClient();

  // --- Identity (required to render anything meaningful) ---------------------
  // Capture status/flags inside the try; do all control flow (notFound / JSX)
  // AFTER it — `notFound()` throws a signal that a catch here would swallow,
  // and the lint rule forbids constructing JSX inside try/catch.
  let provider: ProviderProfile | null = null;
  let identityStatus: number | null = null;
  let identityFailed = false;
  try {
    const { data, error, response } = await client.GET('/service-providers/{id}', {
      params: { path: { id } },
    });
    identityStatus = response.status;
    if (response.status === 404 || response.status === 400) {
      // Unknown provider → 404; a malformed (non-UUID) id → 400 via
      // ParseUUIDPipe. Neither is a server error to surface — handled below.
    } else if (error || !response.ok || !data) {
      identityFailed = true;
    } else {
      // Generated type degrades nullable fields to `Record<string, never>` —
      // cast through the faithful local mirror (see lib/providers/types.ts).
      provider = data as unknown as ProviderProfile;
    }
  } catch {
    identityFailed = true;
  }

  // Unknown provider or malformed id → Next's native not-found page.
  if (identityStatus === 404 || identityStatus === 400) {
    notFound();
  }
  if (identityFailed || !provider) {
    return (
      <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
        <section className="w-full max-w-3xl">
          <StateCard title="Profil indisponible">
            Ce profil prestataire n’a pas pu être chargé. Réessayez plus tard.
          </StateCard>
        </section>
      </main>
    );
  }

  // --- Catalogue (degrades gracefully — identity must stay readable) ---------
  let services: ProviderCatalogItem[] | null = null;
  try {
    const { data, error, response } = await client.GET(
      '/service-providers/{providerId}/services',
      { params: { path: { providerId: id } } },
    );
    if (!error && response.ok && Array.isArray(data)) {
      // The two i18n maps are typed natively; only the three nullable scalars
      // are surgically re-typed by the mirror (cf. lib/providers/types.ts).
      services = data as unknown as ProviderCatalogItem[];
    }
  } catch {
    // Leave `services` null → sober « catalogue unavailable » notice below.
  }

  // `businessName` is nullable and the DTO carries no first/last-name fallback,
  // so degrade to a sober placeholder (no invented field, no extra API call).
  const providerName = provider.businessName ?? 'Prestataire';

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {providerName}
          </h1>
          {provider.headline && (
            <p className="mt-1 text-zinc-600 dark:text-zinc-300">{provider.headline}</p>
          )}
          {provider.bio && (
            <p className="mt-3 whitespace-pre-line text-sm text-zinc-500 dark:text-zinc-400">
              {provider.bio}
            </p>
          )}
        </header>

        <section aria-labelledby="services-title">
          <h2
            id="services-title"
            className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            Services
          </h2>

          {services === null ? (
            <EmptyHint>Le catalogue de services n’a pas pu être chargé.</EmptyHint>
          ) : services.length === 0 ? (
            <EmptyHint>Ce prestataire n’a pas encore de service réservable.</EmptyHint>
          ) : (
            <ul className="space-y-4">
              {services.map((item) => (
                <ServiceRow
                  key={item.id}
                  providerId={id}
                  item={item}
                  coordsQuery={coordsQuery}
                />
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}
