import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';
import { UNAVAILABLE_MESSAGE } from '@/lib/calendar/calendar-rules';

/**
 * BFF relays of the iCal subscription link.
 *
 * `POST   /api/service-providers/me/calendar/feed` → generates the link (or
 *   replaces it, which revokes the previous one). The answer carries the token
 *   ONCE: the API only keeps its hash.
 * `DELETE /api/service-providers/me/calendar/feed` → revokes it.
 *
 * No body in either direction besides the API's own answer, relayed verbatim.
 * ⚠️ `no-store` on the POST answer: it holds a bearer secret.
 */
export async function POST() {
  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/service-providers/me/calendar/feed');
    return NextResponse.json(error ?? data ?? null, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ message: UNAVAILABLE_MESSAGE }, { status: 502 });
  }
}

export async function DELETE() {
  const client = await getServerApiClient();
  try {
    const { error, response } = await client.DELETE('/service-providers/me/calendar/feed');
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(error ?? null, { status: response.status });
  } catch {
    return NextResponse.json({ message: UNAVAILABLE_MESSAGE }, { status: 502 });
  }
}
