import { NextResponse } from 'next/server';

import { resolveApiBaseUrl } from '@/lib/api-base-url';
import { withClientIp } from '@/lib/http/client-ip';

const API_BASE_URL = resolveApiBaseUrl(
  process.env.NEXT_PUBLIC_API_URL,
  process.env.NODE_ENV,
);

/**
 * BFF relay for `POST /auth/verify-email` (L2).
 *
 * Transparent, like `reset-password`: every outcome is about the link the caller
 * holds, and the API already collapses unknown / expired / used / replaced into
 * one 400. No cookie is set (the API opens no session), and a 204 carries no
 * body. `Retry-After` rides along on a 429, and the visitor's address is
 * forwarded so the per-IP budget meters a person, not this server.
 *
 * ⚠️ THE TOKEN IS NEVER LOGGED, on any branch.
 */
export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }
  if (typeof body.token !== 'string') {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  let apiResponse: Response;
  try {
    apiResponse = await fetch(`${API_BASE_URL}/auth/verify-email`, {
      method: 'POST',
      headers: withClientIp({ 'Content-Type': 'application/json' }, request),
      body: JSON.stringify({ token: body.token }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Veuillez réessayer.' },
      { status: 502 },
    );
  }

  if (apiResponse.status === 204) return new NextResponse(null, { status: 204 });

  const payload: unknown = await apiResponse.json().catch(() => null);
  const retryAfter = apiResponse.headers.get('retry-after');
  return NextResponse.json(payload ?? null, {
    status: apiResponse.status,
    headers: retryAfter ? { 'Retry-After': retryAfter } : undefined,
  });
}
