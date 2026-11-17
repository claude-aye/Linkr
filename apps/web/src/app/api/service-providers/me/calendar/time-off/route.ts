import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';
import { UNAVAILABLE_MESSAGE, assembleTimeOffBody } from '@/lib/calendar/calendar-rules';

/**
 * BFF relay — `POST /api/service-providers/me/calendar/time-off` → blocks a
 * period on the provider's calendar.
 *
 * Body assembled field by field (`assembleTimeOffBody`): two instants and an
 * optional private label, nothing else. Status and body relayed verbatim (the
 * 409 keeps its `TIME_OFF_LIMIT_REACHED` code, the 403 its `EMAIL_NOT_VERIFIED`);
 * transport failure → 502.
 */
export async function POST(request: Request) {
  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ message: 'Corps de requête invalide.' }, { status: 400 });
  }

  const body = assembleTimeOffBody(incoming);
  if (!body) {
    return NextResponse.json({ message: 'Période invalide.' }, { status: 400 });
  }

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST(
      '/service-providers/me/calendar/time-off',
      { body },
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json({ message: UNAVAILABLE_MESSAGE }, { status: 502 });
  }
}
