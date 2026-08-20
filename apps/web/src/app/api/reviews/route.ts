import { NextResponse } from 'next/server';

import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF review-write proxy.
 *
 * `POST /api/reviews` → `POST /reviews`. Authenticated server-side by the access
 * cookie (via `getServerApiClient`) and reachable only through the
 * deny-by-default `/api/...` proxy.
 *
 * TRANSPARENT RELAY, like every mutation relay in this codebase: the upstream
 * status (201 / 400 / 403 / 404 / 409 / 429) and body are forwarded verbatim,
 * nothing is interpreted or translated here — the French mapping lives in the
 * client component, BY HTTP CODE ALONE (locked in 3.12b) — the token is never
 * logged, and a transport failure degrades to 502.
 *
 * ⚠️ THE BODY IS ASSEMBLED FIELD BY FIELD, NEVER SPREAD. The API runs with
 * `forbidNonWhitelisted: true`, so one stray key would 400 the whole review.
 * More importantly, the three facts that make a review unfalsifiable (D-1) —
 * who the client is, whether the job is done, which provider is being reviewed —
 * are read server-side from the request; none of them is accepted here, and
 * none may ever be added.
 *
 * A blank comment is dropped rather than forwarded: the DTO trims and rejects a
 * whitespace-only string, and « the user left the box empty » means no comment,
 * not an invalid one.
 */
export async function POST(request: Request) {
  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ message: 'Corps de requête invalide.' }, { status: 400 });
  }

  const source = (incoming ?? {}) as Record<string, unknown>;
  const comment = typeof source.comment === 'string' ? source.comment.trim() : '';

  const body: components['schemas']['CreateReviewDto'] = {
    serviceRequestId: source.serviceRequestId as string,
    rating: source.rating as number,
    ...(comment.length > 0 ? { comment } : {}),
  };

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/reviews', { body });
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
