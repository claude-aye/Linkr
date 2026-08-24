import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF Stripe Connect resync proxy — re-reads the account from Stripe and
 * overwrites the local mirror. The manual repair for a webhook that never landed.
 *
 * `POST /api/service-providers/{providerId}/connect/sync` →
 * `POST /service-providers/{id}/connect/sync`. Authenticated server-side by the
 * access cookie (via `getServerApiClient`) and reachable only through the
 * deny-by-default `/api/...` proxy. Same cookie mechanism, same typed client,
 * same 502-on-transport-failure as its sibling mutation relays.
 *
 * ⚠️ THE FOLDER SLUG IS `[providerId]`, NOT `[id]` — and it is not a free choice.
 * `app/api/service-providers/[providerId]/categories` already exists, and Next
 * refuses two different slug names at the same dynamic path level (the build
 * fails outright). The UPSTREAM path keeps its own name (`{id}`, as the API
 * declares it); the two are independent.
 *
 * OWNERSHIP IS NOT CHECKED HERE, deliberately: `providerId` comes from the
 * browser, and the API is the sole judge — `resolveOwnedIndividualProvider`
 * answers 404 (unknown provider), 501 (ORGANIZATION) or 403 (not the owner).
 * Re-checking it here would be a second, weaker opinion on the same rule.
 *
 * TRANSPARENT RELAY: the upstream status (200/201/403/404/501/502/…) and body go
 * back verbatim. It never interprets or translates — the FR mapping lives in the
 * client island, by HTTP code alone (convention locked since 3.12b). It never
 * logs the token.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/service-providers/{id}/connect/sync',
      { params: { path: { id: providerId } } },
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
