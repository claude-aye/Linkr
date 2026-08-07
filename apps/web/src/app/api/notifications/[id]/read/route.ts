import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF mark-read proxy.
 *
 * `PATCH /api/notifications/{id}/read` → `PATCH /notifications/{id}/read`.
 * Authenticated server-side by the access cookie (via `getServerApiClient`) and
 * reachable only through the deny-by-default `/api/...` proxy — `/api/auth` is
 * the only public prefix, so an anonymous call gets the proxy's 401 JSON.
 *
 * Exact sibling of the four dashboard transition relays (accept / decline /
 * start / complete): TRANSPARENT RELAY — the upstream status (200 / 401 / 404)
 * and body are forwarded verbatim, nothing is interpreted or translated here,
 * the token is never logged, and a transport failure degrades to 502.
 *
 * No body in either direction: the API derives the recipient from the caller's
 * own `sub` and answers 404 (never 403) for a notification that is not theirs.
 */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.PATCH('/notifications/{id}/read', {
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
