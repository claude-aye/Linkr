import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF confirm-completion proxy (the client releases the balance early).
 *
 * `POST /api/service-requests/{id}/confirm-completion` →
 * `POST /service-requests/{id}/confirm-completion`.
 * Authenticated server-side by the access cookie (via `getServerApiClient`) and
 * reachable only through the deny-by-default `/api/...` proxy (session cookie
 * required). Sixth sibling of the accept / decline / start / complete /
 * retry-deposit relays, and written to be indistinguishable from them.
 *
 * TRANSPARENT RELAY: the upstream HTTP status (200/403/404/409/502) and body are
 * forwarded verbatim. This handler never interprets or translates errors — the
 * FR message mapping lives client-side. It never logs the token.
 *
 * NO BODY: the endpoint takes none. The caller's identity comes from the cookie
 * and ownership is checked upstream.
 *
 * The 502 fallback below is TUTOYANT while every screen vouvoies. That
 * divergence is inherited: all five siblings carry the same sentence, and making
 * this one differ would split a copy problem across six files instead of one.
 * Tracked debt, deliberately mirrored rather than half-fixed.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/service-requests/{id}/confirm-completion',
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
