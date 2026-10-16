import { getServerApiClient } from '@/lib/auth/session';
import { relayPortfolioImage } from '@/lib/portfolio/portfolio-media';

/**
 * Web relay of a portfolio image (P1): `GET /media/portfolio/{itemId}` →
 * `GET /portfolio/{itemId}/image` on the API, SERVER-SIDE.
 *
 * Every portfolio `<img>` (P2, P3) points here, at a RELATIVE URL on the web
 * origin — never at the API. The browser therefore never learns the API's
 * address, and the photos work through the Cloudflared tunnel (port 3001 only)
 * and behind the production reverse proxy.
 *
 * ⚠️ PUBLIC: `proxy.ts` lets `/media/portfolio/*` through without a session
 * (`isPortfolioMediaPath`). The API route is `@Public()` too; going through
 * `getServerApiClient()` — like every relay — keeps the API base URL resolved
 * in ONE place (`lib/auth/session.ts`), and a stale access cookie is harmless
 * here: a public route ignores the bearer.
 *
 * This file is only the wiring: the uuid check, the header allow-list and the
 * status mapping live in `relayPortfolioImage`, tested under `node --test`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;

  return relayPortfolioImage(itemId, async (id) => {
    const client = await getServerApiClient();
    // `parseAs: 'stream'` — the body is handed over untouched, never buffered
    // or parsed as JSON.
    const { response } = await client.GET('/portfolio/{itemId}/image', {
      params: { path: { itemId: id } },
      parseAs: 'stream',
    });
    return response;
  });
}
