import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF review-retraction proxy.
 *
 * `DELETE /api/reviews/{id}` → `DELETE /reviews/{id}`. Sibling of the other
 * mutation relays: transparent forwarding of the upstream status and body, the
 * token never logged, 502 on transport failure.
 *
 * ⚠️ THIS RELAY IS THE LAUNCH CONSTRAINT BEING LIFTED. Until it existed, the
 * schema allowed a client to retract their review (D-3) but nothing reachable
 * from a browser did — the right of retraction was a `curl` away, which is fine
 * in development and not fine with real users.
 *
 * No body in either direction. The API scopes the delete to the caller's own
 * review in its WHERE clause and answers 404 — never 403 — for anything else,
 * so this relay has no ownership opinion of its own to add. A 204 carries no
 * body, hence the bare `NextResponse` rather than `NextResponse.json`.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.DELETE('/reviews/{id}', {
      params: { path: { id } },
    });
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
