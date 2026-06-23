import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/cookies';

/**
 * BFF logout. Clears both auth cookies. Idempotent — `delete()` is a no-op when
 * the cookie is already absent, so calling this while logged out still returns 200.
 */
export async function POST() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  return NextResponse.json({ ok: true });
}
