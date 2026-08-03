import { NextResponse } from 'next/server';
import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';

type CreateServiceProviderBody = components['schemas']['CreateServiceProviderDto'];

/**
 * BFF provider-creation proxy — « devenir prestataire » from the web.
 *
 * `POST /api/service-providers` → `POST /service-providers`. Authenticated
 * server-side by the access cookie (via `getServerApiClient`) and reachable only
 * through the deny-by-default `/api/...` proxy. Same cookie mechanism, same typed
 * client, same 502-on-transport-failure as its sibling mutation relays.
 *
 * UNLIKE the pure tube of `api/service-requests`, this handler ASSEMBLES the body
 * FIELD BY FIELD and never spreads the incoming one, for two reasons:
 *
 *  1. `providerType` is PINNED to 'INDIVIDUAL' here. The browser cannot ask for an
 *     ORGANIZATION provider: that path additionally requires an `organizationId`
 *     plus an active OWNER membership, and is not what this form is. `user_id` is
 *     derived by the API from the JWT `sub`, and `organizationId` is FORBIDDEN for
 *     an INDIVIDUAL (the API 400s on it) — so it is never forwarded, whatever the
 *     caller sent.
 *  2. The API runs `ValidationPipe({ forbidNonWhitelisted: true })`: any stray key
 *     a caller slipped in would 400 the whole creation. `headline` and `bio` are
 *     out of this form's scope and are deliberately not settable from here.
 *
 * The GeoJSON Point is BUILT here from two numbers rather than accepted whole, so
 * the [longitude, latitude] footgun (⚠️ longitude FIRST) has exactly one site in
 * this path and a malformed Point cannot be posted from the browser.
 *
 * TRANSPARENT RELAY otherwise: the upstream status (201/400/401/409/…) and body go
 * back verbatim. It never interprets or translates — the FR mapping lives in the
 * form, by HTTP code alone (convention locked since 3.12b). In particular the 409
 * (`ProviderOwnerConflictException` — this owner already has an active provider)
 * reaches the form as a 409, which is the one case the copy must explain. It never
 * logs the token.
 */
interface IncomingBody {
  businessName?: unknown;
  /** Decimal degrees, WGS84 — as returned by `GET /geocode` candidates. */
  lat?: unknown;
  lng?: unknown;
  serviceRadiusKm?: unknown;
}

export async function POST(request: Request) {
  let body: IncomingBody;
  try {
    body = (await request.json()) as IncomingBody;
  } catch {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const { businessName, lat, lng, serviceRadiusKm } = body;

  // Shape checks only — the API stays the business judge (integer, min 0, max
  // length). These guard the assembly itself: a non-number would build a
  // nonsensical Point, and a non-string name cannot be forwarded.
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    typeof serviceRadiusKm !== 'number' ||
    !Number.isFinite(serviceRadiusKm)
  ) {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }
  if (businessName !== undefined && typeof businessName !== 'string') {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const trimmedName = businessName?.trim();

  const payload: CreateServiceProviderBody = {
    providerType: 'INDIVIDUAL',
    serviceRadiusKm,
    // ⚠️ GeoJSON order is [longitude, latitude] — longitude FIRST. Inverting it
    // would plant the provider in the wrong hemisphere (in Québec lng is
    // negative, lat positive). The generated type degrades GeoJSON to
    // `Record<string, never>` (JSONB quirk, CLAUDE.md §6) — cast through unknown.
    serviceBaseLocation: {
      type: 'Point',
      coordinates: [lng, lat],
    } as unknown as CreateServiceProviderBody['serviceBaseLocation'],
    // Optional on the DTO: omitted entirely when blank, never sent as ''.
    ...(trimmedName ? { businessName: trimmedName } : {}),
  };

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/service-providers', {
      body: payload,
    });
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
