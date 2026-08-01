import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { GeocodeCandidate, IGeocodingService } from './geocoding.interface';

/**
 * Key prefix, including a mandatory schema version. Bump `v1` if the key
 * normalisation or the stored value shape ever changes: that invalidates the
 * old entries cleanly instead of serving values the new code misreads.
 */
const CACHE_KEY_PREFIX = 'linkr:geocode:v1';

/**
 * A geocoded point is a stable fact about the world, so it keeps a long TTL.
 */
const HIT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Zero candidates is a statement about the state of an index, not about the
 * world, so it expires far sooner: long enough to absorb a burst of junk input,
 * short enough that an address newly added to OSM shows up quickly.
 */
const EMPTY_TTL_SECONDS = 60 * 60 * 24; // 24 hours

/** Rejects anything that is not a well-formed, finite candidate. */
function isGeocodeCandidate(value: unknown): value is GeocodeCandidate {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<GeocodeCandidate>;
  return (
    typeof candidate.label === 'string' &&
    typeof candidate.lat === 'number' &&
    Number.isFinite(candidate.lat) &&
    typeof candidate.lng === 'number' &&
    Number.isFinite(candidate.lng)
  );
}

/**
 * Redis-backed cache in front of another `IGeocodingService`.
 *
 * Nominatim's usage policy caps us at ~1 request/second per deployment and
 * *requires* caching results; a block is unilateral and by IP, so it would take
 * the whole platform's geocoding down at once. Every cache hit is a call that
 * never leaves — which makes this a compliance condition, not an optimisation.
 *
 * Two properties matter as much as the caching itself:
 *
 * - **Errors are never cached.** A failure from the wrapped instance (the
 *   adapter's 502) propagates untouched and nothing is written. An outage is
 *   transient by nature; a cached 502 would outlive it.
 * - **Every cache failure degrades open.** Redis unreachable, command timeout,
 *   unreadable JSON, failed write: log and continue. A read failure is a miss,
 *   a write failure is ignored, and the service stays exactly as available as
 *   it was with no cache at all.
 *
 * It changes no contract, no message and no status code: seen from the
 * controller it is indistinguishable from the adapter it wraps.
 */
export class CachedGeocodingService implements IGeocodingService {
  private readonly logger = new Logger(CachedGeocodingService.name);

  constructor(
    private readonly inner: IGeocodingService,
    private readonly redis: Redis,
  ) {}

  async geocode(query: string, limit: number): Promise<GeocodeCandidate[]> {
    const key = this.cacheKey(query, limit);

    const cached = await this.read(key);
    if (cached !== null) {
      this.logger.debug(`Cache hit: ${key} (${cached.length} candidate(s))`);
      return cached;
    }
    this.logger.debug(`Cache miss: ${key}`);

    // Errors deliberately escape before any write happens.
    const candidates = await this.inner.geocode(query, limit);

    await this.write(key, candidates);
    return candidates;
  }

  /**
   * `linkr:geocode:v1:<normalised q>:<limit>`
   *
   * `limit` is part of the key because the adapter forwards it to Nominatim —
   * two limits are two different requests. It is a DTO-validated integer in
   * [1, 10], so it never contains a colon: the trailing segment is always
   * unambiguous, even when the address itself contains one.
   *
   * The `q` is normalised **for the key only** — the original string is what
   * gets sent to Nominatim. Trim, lowercase, collapse runs of whitespace.
   * Accents are **preserved**: stripping them would serve "Quebec" results to
   * someone who typed "Québec", and nothing guarantees Nominatim treats the two
   * identically. Case is safe to fold — Nominatim is case-insensitive.
   */
  private cacheKey(query: string, limit: number): string {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
    return `${CACHE_KEY_PREFIX}:${normalized}:${limit}`;
  }

  /** Returns the cached candidates, or null on a miss or any failure. */
  private async read(key: string): Promise<GeocodeCandidate[] | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (err) {
      this.logger.debug(`Cache read failed for ${key}: ${String(err)}`);
      return null;
    }
    if (raw === null) {
      return null;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.logger.debug(`Cache value for ${key} is not JSON — treated as a miss`);
      return null;
    }
    // Re-validate rather than trust the bytes: a truncated value, or one written
    // by a build that shaped it differently, must not surface as a candidate.
    if (!Array.isArray(payload) || !payload.every(isGeocodeCandidate)) {
      this.logger.debug(
        `Cache value for ${key} has an unexpected shape — treated as a miss`,
      );
      return null;
    }
    return payload;
  }

  /** Best-effort write; a failure is logged and swallowed. */
  private async write(
    key: string,
    candidates: GeocodeCandidate[],
  ): Promise<void> {
    const ttl = candidates.length > 0 ? HIT_TTL_SECONDS : EMPTY_TTL_SECONDS;
    try {
      await this.redis.set(key, JSON.stringify(candidates), 'EX', ttl);
      this.logger.debug(
        `Cached ${candidates.length} candidate(s) for ${key} (ttl ${ttl}s)`,
      );
    } catch (err) {
      this.logger.debug(`Cache write failed for ${key}: ${String(err)}`);
    }
  }
}
