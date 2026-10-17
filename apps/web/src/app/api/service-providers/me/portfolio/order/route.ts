import { NextResponse } from 'next/server';

import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';
import { UNAVAILABLE_MESSAGE } from '@/lib/portfolio/portfolio-rules';

/**
 * BFF reorder relay (Portfolio P2).
 *
 * `PUT /api/service-providers/me/portfolio/order` → `PUT /service-providers/me/portfolio/order`.
 *
 * The body is assembled field by field: `ids`, an array of strings, and
 * nothing else. Whether it is EXACTLY the set of live photos is the API's call
 * (422 otherwise). Status and body relayed verbatim; transport failure → 502.
 */
export async function PUT(request: Request) {
  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ message: 'Corps de requête invalide.' }, { status: 400 });
  }

  const ids = (incoming as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    return NextResponse.json({ message: 'Liste de photos invalide.' }, { status: 400 });
  }
  const body: components['schemas']['ReorderPortfolioDto'] = { ids };

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.PUT('/service-providers/me/portfolio/order', {
      body,
    });
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json({ message: UNAVAILABLE_MESSAGE }, { status: 502 });
  }
}
