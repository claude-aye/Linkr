import { getServerApiClient } from '@/lib/auth/session';

const RELAYED_HEADERS = ['content-type', 'content-disposition', 'cache-control'] as const;

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Web relay of the one-off calendar export: `GET /calendrier/export` →
 * `GET /service-providers/me/calendar/export` on the API, with the session
 * cookie, SERVER-SIDE. Answers an `.ics` attachment.
 *
 * WHY A `GET` ROUTE HANDLER (§13.1 nº 6): the read is a FILE DOWNLOAD. A
 * Server Component can render a page, not hand the browser a file to save —
 * no navigation can carry it.
 *
 * PRIVATE: the path has no dot, so `proxy.ts` runs on it (deny-by-default,
 * silent refresh included), and the API decides whose calendar it is from the
 * session. An error answers its status with an empty body — the link is a
 * plain `<a download>`, which has no use for a JSON error.
 */
export async function GET() {
  const client = await getServerApiClient();
  let upstream: Response;
  try {
    const { response } = await client.GET('/service-providers/me/calendar/export', {
      // The document is handed over untouched, never parsed as JSON.
      parseAs: 'stream',
    });
    upstream = response;
  } catch {
    return new Response(null, { status: 502, headers: NO_STORE });
  }

  if (upstream.status !== 200) {
    // NOT awaited: under Next's instrumented `fetch` the body can be one branch
    // of a tee, and `cancel()` then only settles once the other branch is
    // drained — awaiting it hung this handler until the caller gave up
    // (measured: 15 s on an unknown token). The status is all we relay.
    void upstream.body?.cancel().catch(() => undefined);
    return new Response(null, { status: upstream.status, headers: NO_STORE });
  }

  const headers = new Headers();
  for (const name of RELAYED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
