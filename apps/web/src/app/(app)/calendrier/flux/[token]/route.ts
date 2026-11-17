import { resolveApiBaseUrl } from '@/lib/api-base-url';
import { feedTokenFromSegment } from '@/lib/calendar/calendar-rules';
import { withClientIp } from '@/lib/http/client-ip';

const API_BASE_URL = resolveApiBaseUrl(
  process.env.NEXT_PUBLIC_API_URL,
  process.env.NODE_ENV,
);

/** The headers copied from the API's answer. Nothing else crosses the relay. */
const RELAYED_HEADERS = ['content-type', 'content-disposition', 'cache-control'] as const;

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Web relay of the iCal feed: `GET /calendrier/flux/{token}` (or `{token}.ics`)
 * → `GET /calendar/feed/{token}` on the API, SERVER-SIDE.
 *
 * WHY A `GET` ROUTE HANDLER (the BFF otherwise serves mutations only, §13.1
 * nº 6): the reader is not a page and not even a browser — it is Outlook,
 * Google Calendar or Apple Calendar polling a URL. No navigation can carry that
 * read, and the API itself has no public route in production (§11, D3). Same
 * family as `/media/portfolio/{id}`.
 *
 * ⚠️ PUBLIC, AND THE TOKEN IS THE CREDENTIAL. A calendar app sends no cookie.
 * `proxy.ts` lets the path through without a session (`isCalendarFeedPath`);
 * with the `.ics` suffix the proxy does not even run (its matcher skips any
 * path containing a dot). The token is 32 random bytes, stored hashed by the
 * API; it is never logged here.
 *
 * - malformed token → 404, and the API is NOT called;
 * - API 200 → the document, with RELAYED_HEADERS only;
 * - any other status (404 unknown/revoked, 429) → that status, empty body
 *   (`Retry-After` kept on a 429), `no-store`;
 * - API unreachable → 502.
 *
 * The visitor's address rides along (`withClientIp`): the API meters this
 * route per address, and without it every subscriber would share the web
 * server's single bucket.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: segment } = await params;
  const token = feedTokenFromSegment(segment);
  if (!token) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/calendar/feed/${token}`, {
      headers: withClientIp({ Accept: 'text/calendar' }, request),
      cache: 'no-store',
    });
  } catch {
    return new Response(null, { status: 502, headers: NO_STORE });
  }

  if (upstream.status !== 200) {
    // NOT awaited: under Next's instrumented `fetch` the body can be one branch
    // of a tee, and `cancel()` then only settles once the other branch is
    // drained — awaiting it hung this handler until the caller gave up
    // (measured: 15 s on an unknown token). The status is all we relay.
    void upstream.body?.cancel().catch(() => undefined);
    const headers = new Headers(NO_STORE);
    const retryAfter = upstream.headers.get('retry-after');
    if (upstream.status === 429 && retryAfter) headers.set('retry-after', retryAfter);
    return new Response(null, { status: upstream.status, headers });
  }

  const headers = new Headers();
  for (const name of RELAYED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
