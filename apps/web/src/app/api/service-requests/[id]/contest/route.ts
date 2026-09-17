import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF contest proxy (the client freezes the balance auto-release).
 *
 * `POST /api/service-requests/{id}/contest` →
 * `POST /service-requests/{id}/contest`.
 * Authenticated server-side by the access cookie (via `getServerApiClient`) and
 * reachable only through the deny-by-default `/api/...` proxy (session cookie
 * required). Seventh sibling of the accept / decline / start / complete /
 * retry-deposit / confirm-completion relays.
 *
 * TRANSPARENT RELAY: the upstream HTTP status (200/403/404/409) and body are
 * forwarded verbatim. This handler never interprets or translates errors — the
 * FR message mapping lives client-side. It never logs the token.
 *
 * ⚠️ NO BODY, AND THAT IS THE POINT. Contesting sets `contested_at_utc` and
 * NOTHING ELSE — there is no dispute state machine in the MVP. It freezes the
 * auto-release timer so a human can arbitrate off-platform. Accepting a claim
 * body here would suggest a ticketing system that does not exist.
 *
 * The 502 fallback below is TUTOYANT while every screen vouvoies. Inherited
 * divergence, deliberately mirrored across all siblings rather than half-fixed.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/service-requests/{id}/contest',
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
