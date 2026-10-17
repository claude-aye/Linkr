import { NextResponse } from 'next/server';

import type { paths } from '@linkr/api-client';

import { getServerApiClient } from '@/lib/auth/session';
import { PORTFOLIO_LIMITS } from '@/lib/portfolio/portfolio-limits';
import { UNAVAILABLE_MESSAGE, inspectUploadRequest } from '@/lib/portfolio/portfolio-rules';

type UploadBody =
  paths['/service-providers/me/portfolio']['post']['requestBody']['content']['multipart/form-data'];

/**
 * BFF upload relay (Portfolio P2).
 *
 * `POST /api/service-providers/me/portfolio` → `POST /service-providers/me/portfolio`
 * (multipart: `file` + optional `caption`).
 *
 * ⚠️ THE BODY IS FORWARDED BYTE FOR BYTE, WITH ITS OWN `Content-Type`. No
 * `FormData` is rebuilt here and the image is never touched: the multipart
 * boundary travels in that header, and the API reads the type from the bytes.
 * This is the one relay that does not assemble its body field by field — the
 * API's DTO and multer's `files: 1` limit are the whitelist.
 *
 * Before forwarding, `inspectUploadRequest` refuses a non-multipart or empty
 * body (400) and a body Next has TRUNCATED (413): `proxy.ts` runs on `/api/*`,
 * so Next buffers the body and silently cuts it past 10 MB.
 *
 * The upstream status and body are relayed verbatim — 201, 400, 404, 409 (with
 * its `code`), 413, 415, 422. Transport failure → 502, worded with « vous ».
 */
export async function POST(request: Request) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const contentType = request.headers.get('content-type');

  const inspection = inspectUploadRequest(
    contentType,
    request.headers.get('content-length'),
    bytes.byteLength,
    PORTFOLIO_LIMITS,
  );
  if (!inspection.ok) {
    return NextResponse.json({ message: inspection.message }, { status: inspection.status });
  }

  const client = await getServerApiClient();
  try {
    const { data, error, response } = await client.POST('/service-providers/me/portfolio', {
      // The raw bytes stand in for the typed multipart object: the identity
      // serializer hands them to `fetch` untouched, and the explicit header
      // overrides openapi-fetch's JSON default.
      body: bytes as unknown as UploadBody,
      bodySerializer: (body) => body as unknown as BodyInit,
      headers: { 'Content-Type': contentType as string },
    });
    return NextResponse.json(error ?? data ?? null, { status: response.status });
  } catch {
    return NextResponse.json({ message: UNAVAILABLE_MESSAGE }, { status: 502 });
  }
}
