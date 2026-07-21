import { notFound, redirect } from 'next/navigation';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import { pickTranslation } from '@/lib/i18n/translations';
import type { ProviderCatalogItem, ProviderProfile } from '@/lib/providers/types';

import { CreateRequestForm } from './create-request-form';

// Reads the access cookie + live provider data — always rendered per request.
export const dynamic = 'force-dynamic';

/** Loose UUID shape check — a malformed id can never resolve a bookable service. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * « Nouvelle demande » — the real client booking form (Phase 3.13-3-front),
 * replacing the 3.13-2-front stub. It CLOSES the client transactional loop:
 * provider profile → « Demander » CTA → this page → `POST /api/service-requests`
 * → an OPEN request targeted at the provider → the provider's dashboard.
 *
 * The price is NEVER entered nor passed through the URL: it is DERIVED from a
 * SERVER re-read of the provider's catalogue (anti-tampering guard —
 * `estimatedAmount` is free-form on the backend). Any failure to derive
 * (unknown provider / unknown service id / QUOTE_ONLY / null price) → notFound().
 */
export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{
    providerId?: string;
    serviceId?: string;
    // Real searched coordinate, threaded via the URL (voie Ⓐ, Phase 3.14c-1).
    lat?: string;
    lng?: string;
  }>;
}) {
  // The page is PRIVATE (it lives under `(app)`) even though the underlying API
  // endpoints are `@Public()` — without this gate an expired session could still
  // render. `redirect` throws, so it stays outside any try/catch.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { providerId, serviceId, lat, lng } = await searchParams;
  // Missing or malformed ids can never resolve a bookable service → not-found.
  if (!providerId || !serviceId || !UUID_RE.test(providerId) || !UUID_RE.test(serviceId)) {
    notFound();
  }

  const client = await getServerApiClient();

  // --- Derive money + ids from a SERVER re-read of the provider's catalogue ---
  // Capture the result inside the try; do all control flow (notFound / JSX)
  // AFTER — `notFound()` throws a signal a catch here would swallow, and the
  // lint rule forbids constructing JSX inside try/catch.
  let item: ProviderCatalogItem | null = null;
  let catalogueFailed = false;
  try {
    const { data, error, response } = await client.GET(
      '/service-providers/{providerId}/services',
      { params: { path: { providerId } } },
    );
    if (error || !response.ok || !Array.isArray(data)) {
      // Unknown provider (404) / malformed (400) / transport error — all mean
      // there is nothing bookable to render.
      catalogueFailed = true;
    } else {
      // The two i18n maps are typed natively; only the three nullable scalars
      // are surgically re-typed by the mirror (cf. lib/providers/types.ts).
      const found = (data as unknown as ProviderCatalogItem[]).find(
        (s) => s.id === serviceId,
      );
      item = found ?? null;
    }
  } catch {
    catalogueFailed = true;
  }

  // Catalogue unreachable, or the service id is not in this provider's catalogue.
  if (catalogueFailed || !item) {
    notFound();
  }

  // Defence in depth: test the AMOUNT, not just the pricing model. A null price
  // (or QUOTE_ONLY) has no derivable deposit basis → a DIRECT_BOOKING would be
  // dead-on-arrival (3.12b guard: null amount = un-acceptable). Not bookable.
  const priceAmount = item.priceAmount;
  if (priceAmount == null || item.pricingModel === 'QUOTE_ONLY') {
    notFound();
  }

  // --- Identity (best-effort — only to name the provider in the copy) --------
  let businessName: string | null = null;
  try {
    const { data, error, response } = await client.GET('/service-providers/{id}', {
      params: { path: { id: providerId } },
    });
    if (!error && response.ok && data) {
      businessName = (data as unknown as ProviderProfile).businessName;
    }
  } catch {
    // Leave null → sober fallback below (no invented field, no extra call).
  }

  // Fallback reads naturally inside « Demande à … » / « … envoyée à … ».
  const providerName = businessName ?? 'ce prestataire';

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <CreateRequestForm
        providerId={providerId}
        businessName={providerName}
        serviceItemId={item.serviceItemId}
        serviceCategoryId={item.serviceCategoryId}
        tradeLabel={pickTranslation(item.serviceCategoryNameTranslations)}
        serviceLabel={pickTranslation(item.serviceItemNameTranslations)}
        priceAmount={priceAmount}
        priceCurrency={item.priceCurrency}
        lat={lat}
        lng={lng}
      />
    </main>
  );
}
