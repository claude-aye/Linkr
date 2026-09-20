import { NextResponse } from 'next/server';

import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF save-a-payment-method proxy.
 *
 * `POST /api/payment-methods` → `POST /payment-methods`. Sibling of the other
 * mutation relays (`retry-deposit`, `reviews/{id}/response`, …): the access
 * cookie is read server-side by `getServerApiClient`, the upstream status and
 * body are forwarded verbatim, the token is never logged, and a transport
 * failure becomes a 502.
 *
 * ⚠️ THIS IS THE SINGLE WRITE PATH, AND IT STAYS SINGLE. The SetupIntent
 * (`./setup-intent`) authenticates the card and writes nothing; every saved row
 * is born here. The default flag, the 409 on a card already saved and the
 * unsupported-type 422 all live in ONE service method upstream — duplicating
 * the write client-side would duplicate those three rules with it.
 *
 * ⚠️ NO `GET` HERE, ON PURPOSE. The screen is a Server Component that reads the
 * list with the cookie server-side, and the modal refreshes it with
 * `router.refresh()` — the Server Component stays the source of truth. Per the
 * BFF admissibility test in CLAUDE.md §3: a navigation CAN carry this read (it
 * destroys no half-filled form), so it does not qualify for a route handler. A
 * `GET` added here would be a second, unused read path — the exact drift the
 * rule exists to prevent.
 *
 * ⚠️ THE BODY IS ASSEMBLED FIELD BY FIELD, NEVER SPREAD — `forbidNonWhitelisted`
 * upstream 400s a stray key, and the shape is taken from the generated DTO so a
 * rename breaks the build here rather than at runtime.
 *
 * Copy note: unlike the four `service-requests` relays, the 502 fallback below
 * VOUVOIES. Those four share one tutoyant sentence and are kept identical on
 * purpose (tracked debt); this family is new, has no such sibling to mirror,
 * and the vouvoiement is the project-wide convention — a new file does not
 * inherit a debt it can simply not contract.
 */
export async function POST(request: Request) {
  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ message: 'Corps de requête invalide.' }, { status: 400 });
  }

  const source = (incoming ?? {}) as Record<string, unknown>;
  const body: components['schemas']['CreatePaymentMethodDto'] = {
    stripePaymentMethodId:
      typeof source.stripePaymentMethodId === 'string'
        ? source.stripePaymentMethodId
        : '',
    // The API is the sole judge of the rest (`pm_` prefix, ownership, card
    // type); this relay only narrows the shape.
    setDefault: source.setDefault === true,
  };

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/payment-methods', { body });
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Veuillez réessayer plus tard.' },
      { status: 502 },
    );
  }
}
