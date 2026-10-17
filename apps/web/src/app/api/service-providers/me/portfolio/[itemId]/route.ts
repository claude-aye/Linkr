import { NextResponse } from 'next/server';

import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';
import { UNAVAILABLE_MESSAGE } from '@/lib/portfolio/portfolio-rules';

/**
 * BFF relays of one portfolio photo (Portfolio P2).
 *
 * `PATCH  /api/service-providers/me/portfolio/{itemId}` → caption (set or clear);
 * `DELETE /api/service-providers/me/portfolio/{itemId}` → soft delete + file
 * deletion, API-side.
 *
 * Whose photo it is, is decided by the API from the session (404 when it is
 * not yours). Status and body relayed verbatim; 204 without a body; transport
 * failure → 502.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;

  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ message: 'Corps de requête invalide.' }, { status: 400 });
  }

  // Field by field: `caption`, a string or null — nothing else. An empty string
  // clears it, like null (the API normalises both). `PATCH {}` never leaves.
  const source = (incoming ?? {}) as Record<string, unknown>;
  const caption = source.caption;
  if (caption !== null && typeof caption !== 'string') {
    return NextResponse.json({ message: 'Légende invalide.' }, { status: 400 });
  }
  const body: components['schemas']['UpdatePortfolioCaptionDto'] = { caption };

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.PATCH(
      '/service-providers/me/portfolio/{itemId}',
      { params: { path: { itemId } }, body },
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json({ message: UNAVAILABLE_MESSAGE }, { status: 502 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;

  const client = await getServerApiClient();
  try {
    const { error, response } = await client.DELETE('/service-providers/me/portfolio/{itemId}', {
      params: { path: { itemId } },
    });
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(error ?? null, { status: response.status });
  } catch {
    return NextResponse.json({ message: UNAVAILABLE_MESSAGE }, { status: 502 });
  }
}
