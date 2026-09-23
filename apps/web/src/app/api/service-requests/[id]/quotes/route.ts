import { NextResponse } from 'next/server';

import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * Quebec-only launch: a quote is always in CAD. FROZEN here, server-side, in ONE
 * place — never read from the incoming body, so the browser cannot pick the
 * currency of a price it quotes. Same shape as `QUEBEC_LOCALE_DEFAULTS` in the
 * signup relay: the day Linkr leaves Quebec, this is the line that changes.
 */
const QUOTE_CURRENCY = 'CAD';

/**
 * BFF quote-submit proxy (PR 3 « Appel d'offres »).
 *
 * `POST /api/service-requests/{id}/quotes` → `POST /service-requests/{id}/quotes`.
 * Authenticated server-side by the access cookie and reachable only through the
 * deny-by-default `/api/...` proxy.
 *
 * TRANSPARENT RELAY for the response: the upstream status (201 / 400 / 403 /
 * 404 / 409) and body are forwarded verbatim, the French mapping lives in the
 * client island BY HTTP CODE ALONE (lock 3.12b), the token is never logged, and
 * a transport failure degrades to 502 (tutoyant — inherited, mirrored debt).
 *
 * ⚠️ THE BODY IS ASSEMBLED FIELD BY FIELD, NEVER SPREAD. The API runs with
 * `forbidNonWhitelisted: true`, so one stray key would 400 the whole quote; and
 * the currency must not be steerable from the browser (above). None of the
 * facts that decide whether this provider may quote — who he is, his trade
 * eligibility, the tender's state and deadline, whether it is his own tender —
 * is accepted here: the API reads them all server-side.
 *
 * Values are forwarded as received (no coercion): the client module
 * (`lib/service-requests/tender-rules.ts`) already produced the right types, and
 * a malformed value is the API's to refuse with a 400, not ours to repair.
 * `proposedStartAtUtc` is optional and only forwarded when present.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ message: 'Corps de requête invalide.' }, { status: 400 });
  }

  const source = (incoming ?? {}) as Record<string, unknown>;

  const body: components['schemas']['SubmitQuoteDto'] = {
    amount: source.amount as number,
    currency: QUOTE_CURRENCY,
    estimatedDurationMinutes: source.estimatedDurationMinutes as number,
    description: source.description as string,
    validUntilUtc: source.validUntilUtc as string,
    ...(typeof source.proposedStartAtUtc === 'string'
      ? { proposedStartAtUtc: source.proposedStartAtUtc }
      : {}),
  };

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/service-requests/{id}/quotes', {
      params: { path: { id } },
      body,
    });
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
