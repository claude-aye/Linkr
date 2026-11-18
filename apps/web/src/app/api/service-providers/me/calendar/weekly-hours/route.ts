import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';
import { UNAVAILABLE_MESSAGE, assembleWeeklyHoursBody } from '@/lib/calendar/calendar-rules';

/**
 * BFF relay — `PUT /api/service-providers/me/calendar/weekly-hours` → replaces
 * the provider's published weekly opening hours as a whole.
 *
 * The body is assembled FIELD BY FIELD (`assembleWeeklyHoursBody`): the API
 * runs with `forbidNonWhitelisted`, so one stray key would 400 the whole save.
 * Whose calendar it is, is decided by the API from the session. Status and
 * body are relayed verbatim (the 403 `EMAIL_NOT_VERIFIED` keeps its code);
 * transport failure → 502.
 */
export async function PUT(request: Request) {
  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ message: 'Corps de requête invalide.' }, { status: 400 });
  }

  const body = assembleWeeklyHoursBody(incoming);
  if (!body) {
    return NextResponse.json({ message: 'Heures invalides.' }, { status: 400 });
  }

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.PUT(
      '/service-providers/me/calendar/weekly-hours',
      { body },
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json({ message: UNAVAILABLE_MESSAGE }, { status: 502 });
  }
}
