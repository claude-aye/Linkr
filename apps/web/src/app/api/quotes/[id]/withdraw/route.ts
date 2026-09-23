import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF quote-withdraw proxy (PR 3 « Appel d'offres »).
 *
 * `POST /api/quotes/{id}/withdraw` → `POST /quotes/{id}/withdraw`. Authenticated
 * server-side by the access cookie (via `getServerApiClient`) and reachable only
 * through the deny-by-default `/api/...` proxy. No body in either direction.
 *
 * TRANSPARENT RELAY, like every mutation relay here: the upstream status
 * (200 / 403 / 404 / 409) and body are forwarded verbatim; the French mapping
 * lives in the client island, BY HTTP CODE ALONE (lock 3.12b). Ownership is NOT
 * re-checked here — the API is the sole judge (`NotQuoteOwnerException`, 403).
 *
 * The 502 fallback is TUTOYANT while every screen vouvoies — inherited debt,
 * mirrored verbatim so this relay does not drift from its siblings.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/quotes/{id}/withdraw', {
      params: { path: { id } },
    });
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
