import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF accept proxy (Phase B — provider dashboard transitions).
 *
 * `POST /api/service-requests/{id}/accept` → `POST /service-requests/{id}/accept`.
 * Authenticated server-side by the access cookie (via `getServerApiClient`) and
 * reachable only through the deny-by-default `/api/...` proxy (session cookie
 * required). Modeled on the admin verification approve/reject handlers.
 *
 * TRANSPARENT RELAY: the upstream HTTP status (200/403/404/409/422/…) and body
 * are forwarded verbatim. This handler never interprets or translates errors —
 * the FR message mapping lives client-side (PR 2). It never logs the token.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/service-requests/{id}/accept',
      { params: { path: { id } } },
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
