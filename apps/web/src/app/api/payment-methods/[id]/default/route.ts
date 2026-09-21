import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF set-as-default proxy.
 *
 * `POST /api/payment-methods/{id}/default` → `POST /payment-methods/{id}/default`.
 * Same relay contract as its siblings: cookie read server-side, upstream status
 * and body forwarded verbatim (403 / 404 mapped by status alone on the screen),
 * 502 on transport failure. No body in either direction — which method, and
 * whose, is decided by the path plus the token.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/payment-methods/{id}/default',
      { params: { path: { id } } },
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Veuillez réessayer plus tard.' },
      { status: 502 },
    );
  }
}
