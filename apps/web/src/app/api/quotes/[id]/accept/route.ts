import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF quote-accept proxy (PR 4b « Appel d'offres »).
 *
 * `POST /api/quotes/{id}/accept` → `POST /quotes/{id}/accept`. Authenticated
 * server-side by the access cookie (via `getServerApiClient`) and reachable only
 * through the deny-by-default `/api/...` proxy. No request body.
 *
 * ⚠️ THE STATUS IS RELAYED VERBATIM, AND HERE IT CARRIES THE WHOLE MEANING.
 * The API answers 200 (quote accepted, deposit taken) and 202 (quote accepted,
 * job assigned, deposit NOT taken) with the SAME body. A relay that normalised
 * success to 200 would erase the one fact the client must be told: that his
 * payment failed. The French mapping lives in the client island, BY HTTP CODE
 * ALONE (lock 3.12b). Ownership is NOT re-checked here — the API is the sole
 * judge (`NotRequestOwnerException`, 403).
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
    const { data, error, response } = await client.POST('/quotes/{id}/accept', {
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
