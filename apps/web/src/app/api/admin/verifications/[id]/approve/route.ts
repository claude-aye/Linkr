import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF approve proxy (Phase 3.11c-A).
 *
 * `POST /api/admin/verifications/{id}/approve` → `POST /admin/verification-documents/{id}/approve`.
 * Authenticated server-side by the access cookie (b-1 socle, via `getServerApiClient`).
 *
 * RBAC is the API's job alone — this handler does NOT check roles; it simply RELAYS
 * the upstream status (403 non-admin / 404 introuvable / 409 déjà traité / 201 ok)
 * with a generic message. It never logs the token.
 *
 * It sits under `/api/...` (not `/api/auth/*`), so the deny-by-default proxy already
 * requires a session cookie to reach it — intentional and correct.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const client = await getServerApiClient();
  try {
    const { error, response } = await client.POST(
      '/admin/verification-documents/{id}/approve',
      { params: { path: { id } } },
    );
    if (error || !response.ok) {
      return NextResponse.json(
        { message: 'Action impossible.' },
        { status: response.status },
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
