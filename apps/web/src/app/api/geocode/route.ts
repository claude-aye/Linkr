import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF geocode proxy (Phase 3.14c-2 — in-form address geocoding).
 *
 * `GET /api/geocode?q=…` → `GET /geocode?q=…`. Authenticated server-side by the
 * access cookie (via `getServerApiClient`) and reachable only through the
 * deny-by-default `/api/...` proxy (session cookie required). Twin of the POST
 * relays (`service-requests`, the dashboard transitions) — same cookie mechanism,
 * same typed server client, same transparent relay.
 *
 * WHY a GET route handler at all (the app has no other): the request form is a
 * client component and the access token is httpOnly, so it cannot call `/geocode`
 * directly; a `router.push` cannot carry this read either without destroying the
 * half-filled form. It is the one — and so far only — GET the « BFF = mutations »
 * rule now admits (see the admissibility test in CLAUDE.md §Frontend). A Server
 * Action is excluded: the app has none, by documented choice.
 *
 * TRANSPARENT RELAY: the upstream status (200/400/502) and body are forwarded
 * verbatim. ZERO business logic — no filtering, no sorting, no re-mapping of
 * candidates, no « best match ». « The geocoder proposes, the client disposes »
 * is locked since 3.14b. It never logs the token.
 *
 * The one local short-circuit: a missing or blank `q` returns 400 WITHOUT calling
 * the API (upstream would 400 on a blank `q` anyway). Transport failure / API
 * unreachable → 502, exactly like the POST relays.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json(
      { message: 'Le paramètre « q » est requis.' },
      { status: 400 },
    );
  }

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.GET('/geocode', {
      params: { query: { q } },
    });
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
