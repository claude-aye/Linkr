import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF retry-deposit proxy (deposit recovery on an already-assigned job).
 *
 * `POST /api/service-requests/{id}/retry-deposit` →
 * `POST /service-requests/{id}/retry-deposit`.
 * Authenticated server-side by the access cookie (via `getServerApiClient`) and
 * reachable only through the deny-by-default `/api/...` proxy (session cookie
 * required). Fifth sibling of the accept / decline / start / complete relays,
 * and written to be indistinguishable from them.
 *
 * TRANSPARENT RELAY: the upstream HTTP status (200/403/404/409/422/502) and body
 * are forwarded verbatim. This handler never interprets or translates errors —
 * the FR message mapping lives client-side. It never logs the token.
 *
 * The 502 fallback below is TUTOYANT while every screen vouvoies. That
 * divergence is inherited: all four siblings carry the same sentence, and
 * making this one differ would split a copy problem across five files instead of
 * one. Tracked debt, deliberately mirrored rather than half-fixed.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/service-requests/{id}/retry-deposit',
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
