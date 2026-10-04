import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF deposit-confirmation proxy (the CLIENT confirms, from the browser, a
 * deposit the bank refused off-session — 3-D Secure, or a declined card since
 * replaced).
 *
 * `POST /api/service-requests/{id}/deposit-confirmation` →
 * `POST /service-requests/{id}/deposit-confirmation`.
 * Same relay contract as the retry-deposit / accept siblings: cookie read
 * server-side, upstream status and body forwarded VERBATIM
 * (200/401/403/404/409/422/502), 502 on transport failure. The FR mapping lives
 * client-side, by status alone.
 *
 * ⚠️ A MUTATION, AND UNROUTABLE BY CONSTRUCTION. It writes the payment row's
 * card pointer, and it hands out a PaymentIntent client secret: a `router.push`
 * carrying it would put a secret in a URL. The body goes straight to Stripe.js
 * and is never stored, logged, or put in a URL.
 *
 * The 502 fallback below is TUTOYANT while every screen vouvoies — inherited
 * from the siblings and mirrored on purpose (tracked debt).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/service-requests/{id}/deposit-confirmation',
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
