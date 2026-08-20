import { NextResponse } from 'next/server';

import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF provider-reply proxy.
 *
 * `POST /api/reviews/{id}/response` → `POST /reviews/{id}/response`. Sibling of
 * the other mutation relays: transparent forwarding of the upstream status and
 * body, the token never logged, 502 on transport failure.
 *
 * ⚠️ THE BODY IS ASSEMBLED FIELD BY FIELD, NEVER SPREAD, and it holds exactly
 * one field. Which review, which provider, and whether a reply already exists
 * are all decided server-side — the id from the path, the provider from the
 * review, the « only once » from the column. Under `forbidNonWhitelisted` a
 * stray key would 400 the whole reply anyway.
 *
 * A 204 carries no body, hence the bare `NextResponse`. Everything else keeps
 * its upstream body verbatim so the island can map 403 / 404 / 409 / 429 by
 * status code alone.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ message: 'Corps de requête invalide.' }, { status: 400 });
  }

  const source = (incoming ?? {}) as Record<string, unknown>;
  const body: components['schemas']['RespondToReviewDto'] = {
    response: typeof source.response === 'string' ? source.response.trim() : '',
  };

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/reviews/{id}/response', {
      params: { path: { id } },
      body,
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
