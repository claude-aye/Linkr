import { NextResponse } from 'next/server';
import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';

type AddProviderCategoryBody = components['schemas']['AddProviderCategoryDto'];

/**
 * BFF trade-declaration proxy — « déclarer un métier » from the dashboard.
 *
 * `POST /api/service-providers/{providerId}/categories` →
 * `POST /service-providers/{providerId}/categories`. Authenticated server-side by
 * the access cookie (via `getServerApiClient`) and reachable only through the
 * deny-by-default `/api/...` proxy. Same cookie mechanism, same typed client, same
 * 502-on-transport-failure as its sibling mutation relays.
 *
 * The body is ASSEMBLED FIELD BY FIELD and never spread from the incoming one —
 * same rule as `api/service-providers`. Here that assembly is trivial (the DTO has
 * exactly one field), but the reason is not: the API runs
 * `ValidationPipe({ forbidNonWhitelisted: true })`, so a single stray key a caller
 * slipped in would 400 the whole declaration.
 *
 * OWNERSHIP IS NOT CHECKED HERE, deliberately: `providerId` comes from the browser,
 * and the API is the sole judge (`loadOwnedProvider` → 404 if the provider does not
 * exist, 403 if the caller does not own it). Re-checking it here would mean a second
 * call site for the provider lookup and a second, weaker, opinion on RBAC.
 *
 * TRANSPARENT RELAY otherwise: the upstream status (201/400/401/403/404/409/…) and
 * body go back verbatim. It never interprets or translates — the FR mapping lives in
 * the form, by HTTP code alone (convention locked since 3.12b). In particular the
 * 409 (`ProviderCategoryConflictException` — this trade is already declared for this
 * provider) reaches the form as a 409, which is the one case the copy must explain.
 * It never logs the token.
 */
interface IncomingBody {
  serviceCategoryId?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await params;

  let body: IncomingBody;
  try {
    body = (await request.json()) as IncomingBody;
  } catch {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const { serviceCategoryId } = body;

  // Shape check only — the API stays the business judge (`@IsUUID()`, category
  // exists and is active). This guards the assembly itself: a non-string could
  // not be forwarded as the DTO's single field.
  if (typeof serviceCategoryId !== 'string' || serviceCategoryId === '') {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const payload: AddProviderCategoryBody = { serviceCategoryId };

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/service-providers/{providerId}/categories',
      { params: { path: { providerId } }, body: payload },
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
