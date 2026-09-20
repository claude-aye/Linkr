import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF remove-a-payment-method proxy.
 *
 * `DELETE /api/payment-methods/{id}` → `DELETE /payment-methods/{id}`. Same
 * relay contract as its siblings: cookie read server-side, upstream status and
 * body forwarded verbatim, 502 on transport failure.
 *
 * The removal is a soft-delete upstream, and it also promotes the most recent
 * surviving method when the deleted one was the default — one transaction, API
 * side. Nothing about that promotion is decided or replayed here: this handler
 * forwards a call and a status, and the refreshed Server Component shows which
 * card ended up carrying the badge.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.DELETE('/payment-methods/{id}', {
      params: { path: { id } },
    });
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Veuillez réessayer plus tard.' },
      { status: 502 },
    );
  }
}
