import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF relay for `POST /auth/verify-email/resend` (L2).
 *
 * ⚠️ LIVES UNDER `/api/email-verification`, NOT `/api/auth`: the proxy lets
 * `/api/auth/*` through without looking at the session, whereas this call needs
 * one. Out of that prefix it is deny-by-default AND gets the silent refresh, so
 * an access cookie that just expired does not turn the click into a 401.
 *
 * Transparent: status and body (`{ status }` on 200, `{ code }` on 503) are
 * forwarded as-is, plus `Retry-After` on a 429. The French messages live in the
 * client. The 502 sentence vouvoies, unlike the older relays' inherited one.
 */
export async function POST() {
  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/auth/verify-email/resend');
    const retryAfter = response.headers.get('retry-after');
    return NextResponse.json(error ?? data ?? null, {
      status: response.status,
      headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
    });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Veuillez réessayer.' },
      { status: 502 },
    );
  }
}
