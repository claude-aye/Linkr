/**
 * A fixed-window request counter, in memory, with bounded growth.
 *
 * Deliberately free of Nest, HTTP and clocks: it takes a key and an instant and
 * answers whether that key may proceed. That is what makes it directly
 * unit-testable (`fixed-window-counter.spec.ts`) without a fake request, a fake
 * guard or a timer.
 *
 * ## IN MEMORY, NOT IN REDIS — a decision, and the opposite one from the cache
 *
 * `common/redis` exists and this counter does not use it. Three reasons, in
 * order of weight:
 *
 * 1. **A Redis-backed limiter has to choose between two bad failure modes.**
 *    When Redis is unreachable it either fails open (no protection, exactly when
 *    the system is stressed) or fails closed (the protected route dies for
 *    everyone over a cache outage). An in-memory counter has neither dilemma
 *    because it has nothing to fail: it keeps working while Redis is down. The
 *    geocoding limiter reached the same conclusion from the other direction —
 *    "a Redis-backed limiter would go blind at exactly the moment it matters
 *    most".
 * 2. **It adds no dependency to the module that mounts it.** `DemandSignalsModule`
 *    needs no Redis import to be protected.
 * 3. **The API runs as a single process today** — it declares no replica and is
 *    absent from the Compose stack — so a per-process count is exact.
 *
 * ## ⚠️ SINGLE-INSTANCE ASSUMPTION, restated because it degrades silently
 *
 * The count is **per process**. Replicate the API and each caller gets up to
 * N × its budget, with no error and no log — the same trap the geocoding
 * limiter documents. It degrades gently here (a caller gets a larger budget)
 * rather than breaking a third party's policy, which is why this is a caveat
 * and not a blocker, but the way out is a shared counter, never a smaller
 * constant. {@link RateLimitGuard} restates it in a boot-time log so it cannot
 * rot unseen.
 *
 * ## Fixed window, and what that honestly costs
 *
 * Windows are aligned to a caller's first request, not to wall-clock boundaries,
 * and they do not slide. A caller may therefore spend a full budget at the end
 * of one window and another at the start of the next — up to 2 × `limit` across
 * that seam. Said plainly rather than papered over: for the threat this guards
 * (inflating a count over hours) a transient doubling changes nothing, and a
 * sliding window would cost per-request storage of every hit for a property
 * nobody here needs.
 */
export interface RateLimitVerdict {
  allowed: boolean;
  /**
   * Whole seconds until the caller's current window ends, rounded up and never
   * below 1 — the value served as `Retry-After`, which has no sub-second form
   * and for which 0 would invite an immediate retry that is certain to fail.
   */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  /** Instant the window closes, on the same monotonic clock as `now`. */
  resetAt: number;
}

export class FixedWindowCounter {
  private readonly windows = new Map<string, Window>();

  /** Instant of the last full sweep, on the caller-supplied clock. */
  private lastSweepAt = Number.NEGATIVE_INFINITY;

  /**
   * Records one request for `key` and says whether it may proceed.
   *
   * `now` is injected rather than read here so the spec can drive time exactly.
   * Callers pass a **monotonic** reading (`performance.now()`): this measures an
   * elapsed interval, and a wall-clock step must not be able to extend a window
   * or release one early. Same reasoning, and the same clock, as the geocoding
   * limiter's reservation cursor.
   *
   * A refused request does **not** extend the window: the counter stops
   * incrementing once the budget is spent, so hammering a closed window cannot
   * push its own reset further away. Without that, a caller who kept retrying
   * would lock itself out indefinitely — a limiter should throttle, not punish.
   */
  hit(
    key: string,
    limit: number,
    windowMs: number,
    now: number,
  ): RateLimitVerdict {
    this.sweepIfDue(now, windowMs);

    const existing = this.windows.get(key);

    if (!existing || now >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: secondsUntil(now, now + windowMs) };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: secondsUntil(now, existing.resetAt),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      retryAfterSeconds: secondsUntil(now, existing.resetAt),
    };
  }

  /** Live window count — for tests and for the boot-time sanity of readers. */
  get size(): number {
    return this.windows.size;
  }

  /**
   * Drops closed windows, at most once per window length.
   *
   * Without this the map is a slow leak: one entry per distinct key, forever.
   * That is tolerable for a handful of signed-in accounts and NOT tolerable for
   * the anonymous, IP-keyed route this mechanism is being built for — which is
   * exactly why the eviction ships now, with the first user, rather than being
   * left for the second one to discover.
   *
   * O(n) at most once per window is cheap, and it bounds the map to the keys
   * actually seen in the last window — the smallest it could possibly be.
   */
  private sweepIfDue(now: number, windowMs: number): void {
    if (now - this.lastSweepAt < windowMs) {
      return;
    }
    this.lastSweepAt = now;

    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) {
        this.windows.delete(key);
      }
    }
  }
}

function secondsUntil(now: number, resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}
