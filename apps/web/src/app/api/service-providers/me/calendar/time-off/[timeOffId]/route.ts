import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';
import { UNAVAILABLE_MESSAGE } from '@/lib/calendar/calendar-rules';

/**
 * BFF relay — `DELETE /api/service-providers/me/calendar/time-off/{timeOffId}`
 * → removes one blocked period (soft delete, API-side). Whose period it is, is
 * decided by the API from the session (404 when it is not yours). 204 without
 * a body; any other status relayed verbatim; transport failure → 502.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ timeOffId: string }> },
) {
  const { timeOffId } = await params;

  const client = await getServerApiClient();
  try {
    const { error, response } = await client.DELETE(
      '/service-providers/me/calendar/time-off/{timeOffId}',
      { params: { path: { timeOffId } } },
    );
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(error ?? null, { status: response.status });
  } catch {
    return NextResponse.json({ message: UNAVAILABLE_MESSAGE }, { status: 502 });
  }
}
