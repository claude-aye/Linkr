import { NextResponse } from 'next/server';
import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF create proxy (Phase 3.13 — client transactional loop).
 *
 * `POST /api/service-requests` → `POST /service-requests`. Authenticated
 * server-side by the access cookie (via `getServerApiClient`) and reachable only
 * through the deny-by-default `/api/...` proxy (session cookie required). Brother
 * of the four dashboard transition handlers (`accept`/`decline`/`start`/
 * `complete`) — same cookie mechanism, same server client, same transparent relay.
 *
 * TRANSPARENT RELAY: the upstream HTTP status (201/400/401/409/422/…) and body
 * are forwarded verbatim. This handler never interprets, translates, or maps
 * errors — the FR message mapping lives client-side (the `/requests/new` form,
 * by HTTP code alone). It never logs the token.
 *
 * PURE TUBE: the incoming JSON body is forwarded to the API untouched — no
 * validation, no transformation, no injected fields. In particular it never adds
 * `clientUserId`: the API derives the client from the JWT `sub`. Business
 * validation is the API's job (`CreateServiceRequestDto`); building the payload
 * is the form's job.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as components['schemas']['CreateServiceRequestDto'];

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/service-requests', {
      body,
    });
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
