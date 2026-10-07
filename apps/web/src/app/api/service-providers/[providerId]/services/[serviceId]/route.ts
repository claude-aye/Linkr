import { NextResponse } from 'next/server';
import type { components } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';
import { assembleUpdateServiceBody } from '@/lib/provider-services/service-rules';

type UpdateProfessionalServiceBody = components['schemas']['UpdateProfessionalServiceDto'];

/**
 * BFF service-management proxy — edit, enable/disable, and delete one of the
 * provider's services from « Mes métiers ».
 *
 *   `PATCH  /api/service-providers/{providerId}/services/{serviceId}` →
 *   `PATCH  /service-providers/{providerId}/services/{serviceId}`
 *   `DELETE /api/service-providers/{providerId}/services/{serviceId}` →
 *   `DELETE /service-providers/{providerId}/services/{serviceId}` (soft delete)
 *
 * Same cookie, same typed client, same 502-on-transport-failure as its
 * siblings; ownership is the API's call (`loadOwnedProvider`).
 *
 * The PATCH body is ASSEMBLED FIELD BY FIELD (`assembleUpdateServiceBody`,
 * tested under `node --test`): only price, duration, description and
 * `isActive` go through. The trade and the catalogue item of an existing
 * service are not editable, and the model and currency are never steerable
 * from the browser. Two guards matter more than the rest:
 *   - `priceAmount: null` is NEVER forwarded (and the 5 $ floor applies, as on
 *     creation);
 *   - a blanked description leaves as `null`, never `''`.
 * `null` on duration/description CLEARS the column: `@IsOptional` lets it
 * through and the repository writes it.
 *
 * TRANSPARENT RELAY otherwise; a 204 carries no body, hence the bare
 * `NextResponse` on the DELETE.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ providerId: string; serviceId: string }> },
) {
  const { providerId, serviceId } = await params;

  let incoming: unknown;
  try {
    incoming = await request.json();
  } catch {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const assembly = assembleUpdateServiceBody(incoming);
  if (!assembly.ok) {
    return NextResponse.json({ message: 'Requête invalide.' }, { status: 400 });
  }

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.PATCH(
      '/service-providers/{providerId}/services/{serviceId}',
      {
        params: { path: { providerId, serviceId } },
        // The generated DTO types duration/description as `number`/`string`
        // only — it does not know that `null` clears them. Cast for that one
        // reason; the shape itself comes from the tested assembler.
        body: assembly.body as UpdateProfessionalServiceBody,
      },
    );
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: 'Service indisponible. Réessaie plus tard.' },
      { status: 502 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ providerId: string; serviceId: string }> },
) {
  const { providerId, serviceId } = await params;

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.DELETE(
      '/service-providers/{providerId}/services/{serviceId}',
      { params: { path: { providerId, serviceId } } },
    );
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
