import { BadGatewayException, Logger } from '@nestjs/common';
import { GeocodeCandidate, IGeocodingService } from './geocoding.interface';

/**
 * One outbound request per second — Nominatim's usage policy for the public
 * OpenStreetMap instance (https://operations.osmfoundation.org/policies/nominatim/).
 *
 * Deliberately a constant and not an environment variable: it is an externally
 * imposed constraint that travels with the provider, not a deployment tuning
 * knob. A deployment that could raise it would be a deployment against a
 * different provider — which is a new adapter behind the seam, not a new value
 * here.
 */
const MIN_INTERVAL_MS = 1000;

/**
 * How long a request may wait for its slot before being refused.
 *
 * A geocode already costs ~1 s, so waiting one more is invisible where an error
 * is not. At one request per second an immediate refusal would fire as soon as
 * two users search at the same instant, which is ordinary traffic, not a surge.
 */
const MAX_WAIT_MS = 3000;

/**
 * The repository's first asynchronous wait — there was no `sleep`/`delay`
 * utility to reuse, and none is introduced beyond this file's needs.
 *
 * One-shot and un-raced by construction (see the class comment): the timer
 * fires, resolves, and is released by the runtime. There is no losing branch
 * left holding a pending timer, so there is nothing to `clearTimeout`. It is
 * deliberately **not** `unref()`ed, unlike the Redis watchdog: this timer is a
 * step of an in-flight HTTP request, so it should hold the process for its
 * (at most `MAX_WAIT_MS`) duration rather than let a shutdown drop the request.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Rate cap in front of another `IGeocodingService`, holding the outbound
 * request rate to Nominatim's published limit.
 *
 * It sits **under** the cache (`Cache → RateLimit → Adapter`), so a cache hit
 * consumes nothing: only calls that really leave the server are metered. The
 * reverse order would spend the quota on traffic that never crosses the wire.
 *
 * The cache is the primary lever; this is the floor under it. It is what still
 * holds when the cache cannot absorb — new addresses, a burst of distinct
 * users, or **Redis down, in which case there is no cache at all and 100 % of
 * the traffic goes out**. That last case is why the counter is in memory and
 * depends on nothing: a Redis-backed limiter would go blind at exactly the
 * moment it matters most.
 *
 * ## SINGLE-INSTANCE ASSUMPTION
 *
 * The counter is **per process**. Today the API runs as one process (it is
 * absent from the Compose stack and declares no replica), so the count is
 * exact, not approximate. The day it is replicated, the real outbound rate
 * becomes N × the cap **silently** — no error, no log, just a block from
 * Nominatim. The way out at that point is a shared counter (Redis) or a single
 * dedicated worker owning all outbound geocoding; it is not a bigger constant
 * here. The assumption is restated in a boot-time log so it cannot rot unseen.
 *
 * ## Correctness
 *
 * Slots are handed out by a **reservation cursor** rather than a refilling
 * bucket: `nextSlotAt` is the earliest instant the next call may leave, and a
 * caller claims a slot by pushing it one interval forward.
 *
 * - **No double grant.** The read-modify-write of `nextSlotAt` is one
 *   synchronous block with no `await` inside it. On Node's single JS thread it
 *   cannot interleave, so two callers finding the bucket empty at the same
 *   instant necessarily reserve two *consecutive* slots, never the same one.
 * - **First-come, first-served.** Reservations are issued in arrival order and
 *   are strictly increasing, and each caller sleeps until its own slot, so
 *   callers leave in arrival order. No one can be overtaken, and no one waits
 *   indefinitely: an admitted caller's wait is bounded by `MAX_WAIT_MS` at the
 *   moment it is granted.
 * - **No burst.** Capacity is exactly one. `Math.max(now, nextSlotAt)` lets an
 *   idle period grant one immediate call and no more — an hour of silence
 *   cannot be spent as a thousand calls in a second, which would violate the
 *   policy even though the average respects it.
 * - **A refusal reserves nothing.** A request that never calls out must not
 *   burn a slot, or refusals would push the queue further out and starve the
 *   callers behind them.
 *
 * A token is consumed at the moment of the outbound call, **whether it
 * succeeds or fails**: it is never handed back on error, because the request
 * did leave the server. Errors from the wrapped instance propagate untouched —
 * this decorator neither translates nor swallows them.
 */
export class RateLimitedGeocodingService implements IGeocodingService {
  private readonly logger = new Logger(RateLimitedGeocodingService.name);

  /**
   * Earliest instant the next outbound call may leave, on the **monotonic**
   * clock. `performance.now()` rather than `Date.now()`: this measures an
   * elapsed interval, and a wall-clock step (NTP) must not be able to stall the
   * limiter for the length of the jump, nor release a burst.
   */
  private nextSlotAt = 0;

  constructor(private readonly inner: IGeocodingService) {
    // `log`, not `debug`: the single-instance assumption must be visible in
    // ordinary boot output, since replication breaks it silently.
    this.logger.log(
      `Outbound geocoding capped at 1 request / ${MIN_INTERVAL_MS} ms ` +
        `(a caller waits at most ${MAX_WAIT_MS} ms for a slot, then is refused). ` +
        'This counter is per-process and assumes a SINGLE API instance: ' +
        'replicas would multiply the real outbound rate by their count.',
    );
  }

  async geocode(query: string, limit: number): Promise<GeocodeCandidate[]> {
    const waitMs = this.reserveSlot();

    if (waitMs > 0) {
      this.logger.debug(
        `Waiting ${Math.round(waitMs)} ms for the next outbound slot`,
      );
      await sleep(waitMs);
    } else {
      this.logger.debug('Slot available — calling out immediately');
    }

    // Errors propagate untouched, and the slot stays spent: the request left.
    return this.inner.geocode(query, limit);
  }

  /**
   * Claims the next outbound slot and returns how long to wait for it, or
   * throws the adapter's 502 when that wait would exceed `MAX_WAIT_MS`.
   *
   * Fully synchronous on purpose — this is what makes the claim atomic.
   *
   * The refusal is raised **up front** rather than after sleeping the full
   * budget. The cursor only ever moves forward, so a wait longer than the cap
   * is a certainty, not a forecast: sleeping 3 s to deliver a failure that is
   * already decided would add latency and change nothing. The outcome and the
   * message are identical either way.
   */
  private reserveSlot(): number {
    const now = performance.now();
    const slotAt = Math.max(now, this.nextSlotAt);
    const waitMs = slotAt - now;

    if (waitMs > MAX_WAIT_MS) {
      this.logger.debug(
        `Refusing: the next slot is ${Math.round(waitMs)} ms away, over the ` +
          `${MAX_WAIT_MS} ms cap`,
      );
      // No reservation on this path — see "A refusal reserves nothing" above.
      throw this.unavailable();
    }

    // Read-modify-write, no `await` in between: cannot interleave.
    this.nextSlotAt = slotAt + MIN_INTERVAL_MS;
    return waitMs;
  }

  /**
   * The adapter's 502, verbatim.
   *
   * Saturation and a Nominatim outage are the same event seen from the client —
   * "momentarily unavailable, try again" — and the front already maps this to
   * `unresolved / 'unavailable'` with a Retry button. The message is duplicated
   * rather than shared because factoring it out would mean editing the adapter,
   * which this change leaves untouched; the two must be kept in step.
   */
  private unavailable(): BadGatewayException {
    return new BadGatewayException(
      "La recherche d'adresse est momentanément indisponible. Veuillez réessayer.",
    );
  }
}
