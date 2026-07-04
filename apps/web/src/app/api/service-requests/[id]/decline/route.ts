import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF decline proxy (Phase B — provider dashboard transitions).
 *
 * `POST /api/service-requests/{id}/decline` → `POST /service-requests/{id}/decline`.
 * Reads an OPTIONAL JSON body `{ reason?: string }` and forwards it upstream. The
 * reason is optional per `DeclineServiceRequestDto`, so a missing/empty/non-JSON
 * body is fine (the request is declined without a reason). Authenticated
 * server-side by the access cookie and reachable only through the deny-by-default
 * `/api/...` proxy (session cookie required). Modeled on the admin verification
 * approve/reject handlers.
 *
 * TRANSPARENT RELAY: the upstream HTTP status (200/403/404/409/422/…) and body
 * are forwarded verbatim. This handler never interprets or translates errors —
 * the FR message mapping lives client-side (PR 2). It never logs the token.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Optional body — a missing, empty, or non-JSON body simply means "no reason".
  let reason: string | undefined;
  try {
    const body = (await request.json()) as { reason?: unknown } | null;
    if (typeof body?.reason === 'string') reason = body.reason;
  } catch {
    // No body / invalid JSON: decline without a reason (it is optional).
  }

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/service-requests/{id}/decline',
      {
        params: { path: { id } },
        body: reason !== undefined ? { reason } : {},
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
