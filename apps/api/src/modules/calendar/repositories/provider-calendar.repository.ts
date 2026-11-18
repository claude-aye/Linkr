import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { TIME_OFF_MAX_UPCOMING } from '../constants';
import { ProviderCalendar } from '../entities/provider-calendar.entity';
import { ProviderTimeOff } from '../entities/provider-time-off.entity';
import type { WeeklyRange } from '../weekly-hours';

/** The settings row, as the service needs it. `feedTokenHash` never leaves the API. */
export interface ProviderCalendarRecord {
  serviceProviderId: string;
  timeZone: string;
  /** Raw JSONB — the service runs it through `readWeeklyHours`. */
  weeklyHours: unknown;
  hasFeed: boolean;
  feedTokenCreatedAtUtc: Date | null;
  updatedAtUtc: Date;
}

export interface TimeOffRecord {
  id: string;
  serviceProviderId: string;
  startsAtUtc: Date;
  endsAtUtc: Date;
  label: string | null;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

export interface CreateTimeOffData {
  serviceProviderId: string;
  startsAtUtc: Date;
  endsAtUtc: Date;
  label: string | null;
}

export type InsertTimeOffResult =
  | { inserted: true; timeOff: TimeOffRecord }
  | { inserted: false; reason: 'LIMIT_REACHED' | 'PROVIDER_GONE' };

/** Who a feed token belongs to — resolved only for a LIVE provider. */
export interface FeedOwner {
  serviceProviderId: string;
  timeZone: string;
}

interface CalendarRow {
  service_provider_id: string;
  time_zone: string;
  weekly_hours: unknown;
  has_feed: boolean;
  feed_token_created_at_utc: Date | null;
  updated_at_utc: Date;
}

interface TimeOffRow {
  id: string;
  service_provider_id: string;
  starts_at_utc: Date;
  ends_at_utc: Date;
  label: string | null;
  created_at_utc: Date;
  updated_at_utc: Date;
}

/**
 * ⚠️ `feed_token_hash` IS NEVER SELECTED. The only thing a caller may learn is
 * WHETHER a feed exists; the hash is compared inside SQL, in the one lookup
 * that takes it as a parameter.
 */
const CALENDAR_COLUMNS = `
  service_provider_id, time_zone, weekly_hours,
  (feed_token_hash IS NOT NULL) AS has_feed,
  feed_token_created_at_utc, updated_at_utc`;

const TIME_OFF_COLUMNS = `
  id, service_provider_id, starts_at_utc, ends_at_utc, label,
  created_at_utc, updated_at_utc`;

/**
 * The `[rows, affected]` quirk of TypeORM's raw `.query()` on an `UPDATE …
 * RETURNING` under the postgres driver — a local copy, like the others in this
 * repository (chore tracked in CLAUDE.md §6). Without it, `rows.length` is 2 on
 * ZERO rows touched, and « not yours » would read as « deleted ».
 */
function updateReturningRows<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

function mapCalendar(row: CalendarRow): ProviderCalendarRecord {
  return {
    serviceProviderId: row.service_provider_id,
    timeZone: row.time_zone,
    weeklyHours: row.weekly_hours,
    hasFeed: row.has_feed,
    feedTokenCreatedAtUtc: row.feed_token_created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function mapTimeOff(row: TimeOffRow): TimeOffRecord {
  return {
    id: row.id,
    serviceProviderId: row.service_provider_id,
    startsAtUtc: row.starts_at_utc,
    endsAtUtc: row.ends_at_utc,
    label: row.label,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

@Injectable()
export class ProviderCalendarRepository {
  constructor(
    @InjectRepository(ProviderCalendar)
    private readonly calendars: Repository<ProviderCalendar>,
    @InjectRepository(ProviderTimeOff)
    private readonly timeOff: Repository<ProviderTimeOff>,
  ) {}

  // ── Settings row ──────────────────────────────────────────────────────────

  /** The settings row, or null when the provider never wrote one (defaults apply). */
  async findByProvider(providerId: string): Promise<ProviderCalendarRecord | null> {
    const rows: CalendarRow[] = await this.calendars.query(
      `SELECT ${CALENDAR_COLUMNS} FROM provider_calendars WHERE service_provider_id = $1`,
      [providerId],
    );
    return rows.length ? mapCalendar(rows[0]) : null;
  }

  /**
   * Replaces the weekly schedule as a whole, creating the row if needed. One
   * statement: there is no window in which a reader sees half a schedule.
   */
  async saveWeeklyHours(
    providerId: string,
    ranges: readonly WeeklyRange[],
  ): Promise<ProviderCalendarRecord> {
    const rows: CalendarRow[] = await this.calendars.query(
      `INSERT INTO provider_calendars (service_provider_id, weekly_hours)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (service_provider_id)
       DO UPDATE SET weekly_hours = EXCLUDED.weekly_hours, updated_at_utc = now()
       RETURNING ${CALENDAR_COLUMNS}`,
      [providerId, JSON.stringify(ranges)],
    );
    return mapCalendar(rows[0]);
  }

  /**
   * Sets (or replaces) the feed token hash. Replacing IS the revocation of the
   * previous URL: there is one hash per provider, and the old one is gone.
   */
  async setFeedTokenHash(providerId: string, tokenHash: string): Promise<Date> {
    const rows: Array<{ feed_token_created_at_utc: Date }> = await this.calendars.query(
      `INSERT INTO provider_calendars
         (service_provider_id, feed_token_hash, feed_token_created_at_utc)
       VALUES ($1, $2, now())
       ON CONFLICT (service_provider_id)
       DO UPDATE SET feed_token_hash = EXCLUDED.feed_token_hash,
                     feed_token_created_at_utc = EXCLUDED.feed_token_created_at_utc,
                     updated_at_utc = now()
       RETURNING feed_token_created_at_utc`,
      [providerId, tokenHash],
    );
    return rows[0].feed_token_created_at_utc;
  }

  /** Revokes the feed. Idempotent: no feed is not an error. */
  async clearFeedToken(providerId: string): Promise<void> {
    await this.calendars.query(
      `UPDATE provider_calendars
       SET feed_token_hash = NULL, feed_token_created_at_utc = NULL, updated_at_utc = now()
       WHERE service_provider_id = $1 AND feed_token_hash IS NOT NULL`,
      [providerId],
    );
  }

  /**
   * Resolves a feed token hash to its provider — ONLY while that provider is
   * live, and (for an individual) while its owner's account is live too.
   *
   * This join is what makes a closed account's feed URL die without anything
   * to cascade: `deploy/close-account.sh` soft-deletes the user and the
   * provider, and from that instant this lookup finds nothing.
   */
  async findFeedOwner(tokenHash: string): Promise<FeedOwner | null> {
    const rows: Array<{ service_provider_id: string; time_zone: string }> =
      await this.calendars.query(
        `SELECT pc.service_provider_id, pc.time_zone
         FROM provider_calendars pc
         JOIN service_providers sp ON sp.id = pc.service_provider_id
         LEFT JOIN users u ON u.id = sp.user_id
         WHERE pc.feed_token_hash = $1
           AND sp.deleted_at_utc IS NULL
           AND (sp.user_id IS NULL OR u.deleted_at_utc IS NULL)`,
        [tokenHash],
      );
    return rows.length
      ? { serviceProviderId: rows[0].service_provider_id, timeZone: rows[0].time_zone }
      : null;
  }

  // ── Blocked periods ───────────────────────────────────────────────────────

  /** Live periods overlapping `[fromUtc, toUtc)`, in order. */
  async findTimeOffOverlapping(
    providerId: string,
    fromUtc: Date,
    toUtc: Date,
  ): Promise<TimeOffRecord[]> {
    const rows: TimeOffRow[] = await this.timeOff.query(
      `SELECT ${TIME_OFF_COLUMNS} FROM provider_time_off
       WHERE service_provider_id = $1 AND deleted_at_utc IS NULL
         AND ends_at_utc > $2 AND starts_at_utc < $3
       ORDER BY starts_at_utc ASC, id ASC`,
      [providerId, fromUtc, toUtc],
    );
    return rows.map(mapTimeOff);
  }

  /** Live periods not over yet at `nowUtc`, in order — the management list. */
  async findUpcomingTimeOff(providerId: string, nowUtc: Date): Promise<TimeOffRecord[]> {
    const rows: TimeOffRow[] = await this.timeOff.query(
      `SELECT ${TIME_OFF_COLUMNS} FROM provider_time_off
       WHERE service_provider_id = $1 AND deleted_at_utc IS NULL
         AND ends_at_utc > $2
       ORDER BY starts_at_utc ASC, id ASC`,
      [providerId, nowUtc],
    );
    return rows.map(mapTimeOff);
  }

  /**
   * Locks the PROVIDER row for the rest of the transaction — the same lock the
   * portfolio takes, for the same reason: two concurrent inserts at 49 both
   * count 49, and a count is not a lock. Every writer of this provider's
   * blocked periods first takes `FOR UPDATE` on the one row they share.
   */
  private async lockProvider(manager: EntityManager, providerId: string): Promise<boolean> {
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM service_providers
       WHERE id = $1 AND deleted_at_utc IS NULL
       FOR UPDATE`,
      [providerId],
    );
    return rows.length > 0;
  }

  /**
   * Inserts one blocked period, refusing past TIME_OFF_MAX_UPCOMING periods
   * not over yet. Lock, count and insert happen in ONE transaction.
   */
  async insertTimeOffUnderCap(
    data: CreateTimeOffData,
    nowUtc: Date,
  ): Promise<InsertTimeOffResult> {
    return this.timeOff.manager.transaction(async (manager) => {
      if (!(await this.lockProvider(manager, data.serviceProviderId))) {
        return { inserted: false, reason: 'PROVIDER_GONE' } as const;
      }
      const counted: Array<{ count: string }> = await manager.query(
        `SELECT count(*)::text AS count FROM provider_time_off
         WHERE service_provider_id = $1 AND deleted_at_utc IS NULL AND ends_at_utc > $2`,
        [data.serviceProviderId, nowUtc],
      );
      if (Number(counted[0].count) >= TIME_OFF_MAX_UPCOMING) {
        return { inserted: false, reason: 'LIMIT_REACHED' } as const;
      }
      const rows: TimeOffRow[] = await manager.query(
        `INSERT INTO provider_time_off
           (service_provider_id, starts_at_utc, ends_at_utc, label)
         VALUES ($1, $2, $3, $4)
         RETURNING ${TIME_OFF_COLUMNS}`,
        [data.serviceProviderId, data.startsAtUtc, data.endsAtUtc, data.label],
      );
      return { inserted: true, timeOff: mapTimeOff(rows[0]) } as const;
    });
  }

  /**
   * Soft-deletes a live period of THIS provider. False when nothing matched —
   * unknown, already deleted, or someone else's: one answer for the three.
   */
  async softDeleteTimeOff(id: string, providerId: string): Promise<boolean> {
    const result: unknown = await this.timeOff.query(
      `UPDATE provider_time_off
       SET deleted_at_utc = now(), updated_at_utc = now()
       WHERE id = $1 AND service_provider_id = $2 AND deleted_at_utc IS NULL
       RETURNING id`,
      [id, providerId],
    );
    return updateReturningRows<{ id: string }>(result).length > 0;
  }
}
