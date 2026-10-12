import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF balance-confirmation proxy (the CLIENT confirms, from the browser, an 80%
 * balance the bank refused off-session — 3-D Secure, or a declined card since
 * replaced). Twin of `../deposit-confirmation/route.ts`.
 *
 * `POST /api/service-requests/{id}/balance-confirmation` →
 * `POST /service-requests/{id}/balance-confirmation`.
 * Same relay contract as its siblings: cookie read server-side, upstream status
 * and body forwarded VERBATIM (200/401/403/404/409/422/502), 502 on transport
 * failure. The FR mapping lives client-side, by status alone — the SAME mapping
 * as the deposit's, because the two endpoints answer the same codes.
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
      '/service-requests/{id}/balance-confirmation',
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
