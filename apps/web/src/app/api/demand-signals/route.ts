import { NextResponse } from 'next/server';
import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';

/**
 * BFF demand-signal relay (chantier H, tranche 2a).
 *
 * `POST /api/demand-signals` → `POST /demand-signals`. Authenticated
 * server-side by the access cookie (via `getServerApiClient`) and reachable only
 * through the deny-by-default `/api/...` proxy. Brother of the other POST relays
 * (`service-requests`, the dashboard transitions) — same cookie mechanism, same
 * server client, same transparent relay, same 502 on transport failure. It never
 * logs the token.
 *
 * ⚠️ THIS HANDLER IS WHY THE SIGNAL IS NOT WRITTEN DURING A RENDER. `/recherche`
 * establishes `total === 0` inside a Server Component; writing from there would
 * count prefetches, double renders, `router.refresh()` and back-navigations, and
 * the map would measure the browser instead of the market. A POST relay is the
 * sanctioned mutation path (CLAUDE.md §13.1 entry 6), and a `<Link>` prefetch
 * cannot reach it: prefetch fetches the RSC payload, it never mounts a client
 * component or runs its effects.
 *
 * PURE TUBE: the incoming JSON body is forwarded untouched — no validation, no
 * transformation, and above all NO INJECTED FIELDS. In particular it never adds
 * a caller id: the API does not want one, and a demand signal carries no
 * identity by design (see migration 1780510000000). Business validation and the
 * re-verification of the zero claim are the API's job.
 *
 * The one shape deviation from its siblings: upstream answers 204, which must
 * not carry a body — relayed as an empty 204 rather than through
 * `NextResponse.json`. Every other status keeps the verbatim body.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as components['schemas']['RecordDemandSignalDto'];

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/demand-signals', { body });
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}
