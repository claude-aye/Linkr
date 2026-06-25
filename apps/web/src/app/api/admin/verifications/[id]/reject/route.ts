import { NextResponse } from 'next/server';

import { getServerApiClient } from '@/lib/auth/session';
import type { RejectVerificationDocumentBody } from '@/lib/verifications/types';

/**
 * BFF reject proxy (Phase 3.11c-A).
 *
 * `POST /api/admin/verifications/{id}/reject` → `POST /admin/verification-documents/{id}/reject`.
 * The reason is MANDATORY: it is validated here (400 if missing/blank) before the
 * call — the API re-validates it too. The body is sent in the confirmed
 * `RejectVerificationDocumentDto` shape (`{ rejectionReason }`), typed from the
 * generated client.
 *
 * Like its sibling, RBAC is API-side only: this relays the upstream status
 * (403/404/409/200) with a generic message and never logs the token. Reached only
 * through the deny-by-default proxy (session cookie required).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { rejectionReason?: unknown };
  try {
    body = (await request.json()) as { rejectionReason?: unknown };
  } catch {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const rejectionReason =
    typeof body.rejectionReason === 'string' ? body.rejectionReason.trim() : '';
  if (!rejectionReason) {
    return NextResponse.json(
      { message: 'Le motif de rejet est obligatoire.' },
      { status: 400 },
    );
  }

  const client = await getServerApiClient();
  try {
    const payload: RejectVerificationDocumentBody = { rejectionReason };
    const { error, response } = await client.POST(
      '/admin/verification-documents/{id}/reject',
      { params: { path: { id } }, body: payload },
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
