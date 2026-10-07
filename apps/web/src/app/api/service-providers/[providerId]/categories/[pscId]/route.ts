import { NextResponse } from 'next/server';
import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';
import { assembleTradeToggleBody } from '@/lib/provider-trades/trade-lifecycle';

type UpdateProviderCategoryBody = components['schemas']['UpdateProviderCategoryDto'];

/**
 * BFF trade-lifecycle proxy — pause, resume and retire a declared trade from
 * « Mes métiers » (Métiers — PR B).
 *
 *   `PATCH  /api/service-providers/{providerId}/categories/{pscId}` →
 *   `PATCH  /service-providers/{providerId}/categories/{pscId}`  ({ isActive })
 *   `DELETE /api/service-providers/{providerId}/categories/{pscId}` →
 *   `DELETE /service-providers/{providerId}/categories/{pscId}` (soft delete)
 *
 * Lives beside `[pscId]/services/route.ts` (PR A): a route at a segment and one
 * in a sub-segment do not collide, and `[pscId]` is the slug already in use at
 * this level. Same cookie, same typed client, same 502-on-transport-failure as
 * its siblings; ownership is the API's call (`loadOwnedProvider` → 404/403, then
 * `loadProviderPsc` → 404 for another provider's or an already-retired trade).
 *
 * The PATCH body is ASSEMBLED FIELD BY FIELD (`assembleTradeToggleBody`, tested
 * under `node --test`): `isActive`, a BOOLEAN, and nothing else. A boolean is
 * REQUIRED, not merely allowed — the API's field is optional, so a `PATCH {}`
 * would pass its validation and then write `isActive: undefined` (500 risk,
 * CLAUDE.md §6). It never leaves from here.
 *
 * ⚠️ The API accepts pausing a PENDING or REJECTED trade, and retiring a trade
 * that still has active jobs. Both limits live in the interface only — this
 * relay is a pipe, not a second judge.
 *
 * TRANSPARENT RELAY otherwise; a 204 carries no body, hence the bare
 * `NextResponse` on the DELETE. It never logs the token.
 */
export async function PATCH(
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

  const body = assembleTradeToggleBody(incoming);
  if (body === null) {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.PATCH(
      '/service-providers/{providerId}/categories/{pscId}',
      {
        params: { path: { providerId, pscId } },
        body: body satisfies UpdateProviderCategoryBody,
      },
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ providerId: string; pscId: string }> },
) {
  const { providerId, pscId } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.DELETE(
      '/service-providers/{providerId}/categories/{pscId}',
      { params: { path: { providerId, pscId } } },
    );
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
