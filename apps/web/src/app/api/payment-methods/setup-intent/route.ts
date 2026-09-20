import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF SetupIntent proxy.
 *
 * `POST /api/payment-methods/setup-intent` → `POST /payment-methods/setup-intent`.
 * Same relay contract as its siblings: cookie read server-side, upstream status
 * and body forwarded verbatim, 502 on transport failure.
 *
 * ⚠️ A MUTATION DESPITE ITS LOOKS. It reads nothing and returns one field, but
 * it CREATES a Stripe object and — on a first card — the Customer behind it. It
 * is also unroutable by construction: the client secret exists for the modal
 * currently open, and a `router.push` carrying it would put a secret in a URL.
 *
 * The response body is `{ clientSecret }` and nothing else. It is handed
 * straight to Stripe.js and never stored, logged, or put in a URL.
 */
export async function POST() {
  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/payment-methods/setup-intent',
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Veuillez réessayer plus tard.' },
      { status: 502 },
    );
  }
}
