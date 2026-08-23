/**
 * Carries the visitor's address across the BFF hop, so the API's rate limiters
 * meter a PERSON instead of metering this server (chantier B).
 *
 * ⚠️ WITHOUT THIS, EVERY PER-IP BUDGET IS ONE BUCKET SHARED BY THE WHOLE SITE.
 * The browser never talks to the API; it talks to Next, and Next opens its own
 * connection. So the API's socket peer is this server for every visitor alike,
 * and a limiter keyed on it throttles all users together — the first heavy
 * caller locks out everyone else. That is worse than no limiter at all, because
 * the people it stops are the legitimate ones.
 *
 * ⚠️ IT TAKES EFFECT ONLY IF THE API TRUSTS US. Express believes
 * `X-Forwarded-For` solely from a peer listed in `TRUSTED_PROXY_IPS`; from
 * anyone else it is ignored and `request.ip` falls back to the socket peer. Both
 * halves have to be in place — this header alone changes nothing.
 *
 * ⚠️ MEASURED, NOT ASSUMED — AND IT IS WHY ONE VALUE TRAVELS RATHER THAN THE
 * CHAIN. Next (16.2) synthesises `x-forwarded-for` from the socket peer when
 * nothing upstream sent one, but passes a caller-supplied header through
 * VERBATIM: a browser can hand us `1.1.1.1, 2.2.2.2` and we would see exactly
 * that. Relaying such a chain would let the caller choose which entry the API
 * resolves. So we take one address, validate its shape, and send that alone.
 *
 * What remains, stated plainly: a caller who forges the header still picks their
 * own bucket. It is bounded — they cannot drain anyone else's without knowing
 * and forging that person's address, which is true of any per-IP scheme — and it
 * is closed in production by the reverse proxy in front of the web tier, whose
 * job is to overwrite this header with the address it actually saw. Even
 * unclosed it is strictly better than one shared bucket, where a single caller
 * denies the service to everybody.
 */

/** Reasonable IPv4 / IPv6 shapes. Deliberately not a parser — see below. */
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

/**
 * The address to attribute this request to, or `null` when there is nothing
 * credible to attribute it to.
 *
 * Returning `null` is the fail-closed branch: no header goes out, the API falls
 * back to its socket peer, and we are back to the old shared bucket — degraded,
 * never bypassed. Anything not IP-shaped is dropped rather than passed on: a
 * malformed value would reach `proxy-addr`, which throws on garbage, and turning
 * a spoofable header into a 500 would be a far better weapon than the limiter is
 * a defence.
 */
export function resolveClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) {
    return null;
  }

  // Leftmost = the original client by convention, and what a correctly
  // configured reverse proxy puts there. Only this one entry travels onward.
  const candidate = forwarded.split(',')[0]?.trim() ?? '';
  if (candidate.length === 0 || candidate.length > 45) {
    return null;
  }

  // Shape only, not validity: this value is never trusted for a decision here,
  // it is handed to the API which re-decides whether to believe us at all. The
  // check exists to keep malformed input out of `proxy-addr`, not to authorise.
  return IPV4.test(candidate) || IPV6.test(candidate) ? candidate : null;
}

/**
 * Merges the forwarding header into a header bag for a server-to-server call.
 * Returns the bag unchanged when there is no credible address, so every call
 * site is one expression with no branch of its own.
 */
export function withClientIp(
  headers: Record<string, string>,
  request: Request,
): Record<string, string> {
  const ip = resolveClientIp(request);
  return ip ? { ...headers, 'X-Forwarded-For': ip } : headers;
}
