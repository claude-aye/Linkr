import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';
import { assembleCreateServiceBody } from '@/lib/provider-services/service-rules';

/**
 * BFF service-creation proxy — « Ajouter un service » under a declared trade.
 *
 * `POST /api/service-providers/{providerId}/categories/{pscId}/services` →
 * `POST /service-providers/{providerId}/categories/{pscId}/services`. Same
 * cookie, same typed client, same 502-on-transport-failure as its siblings.
 *
 * The body is ASSEMBLED FIELD BY FIELD (`assembleCreateServiceBody`, tested
 * under `node --test`) and never spread: `pricingModel: 'FLAT'` and
 * `priceCurrency: 'CAD'` are FROZEN there, never read from the browser, and any
 * other key is dropped — under `forbidNonWhitelisted: true` one stray key would
 * 400 the whole creation. The 5 $ floor is applied there too, as defense in
 * depth: since Verrous API — PR C1 the API enforces the same floor, and this
 * relay is the one server-side point the web owns.
 *
 * The trade claim's eligibility (paused, PENDING, REJECTED) is refused by the
 * API since Verrous API — PR C1 (409) and by the dashboard (no add form there).
 * This relay adds no third, weaker opinion: it does not know the claim's
 * status without a lookup.
 *
 * TRANSPARENT RELAY otherwise: the upstream status (201/400/401/403/404/409/
 * 422/…) and body go back verbatim; the FR mapping lives in the form, by HTTP
 * status alone (lock 3.12b). Ownership is the API's call (`loadOwnedProvider`).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ providerId: string; pscId: string }> },
) {
  const { providerId, pscId } = await params;

  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const assembly = assembleCreateServiceBody(incoming);
  if (!assembly.ok) {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/service-providers/{providerId}/categories/{pscId}/services',
      { params: { path: { providerId, pscId } }, body: assembly.body },
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
