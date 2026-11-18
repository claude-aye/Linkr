import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuoteStatus } from '../../quotes/enums/quote-status.enum';
import { ServiceRequestStatus } from '../../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../../service-requests/enums/service-request-type.enum';
import { ProviderCalendar } from '../entities/provider-calendar.entity';

/**
 * A provider's appointments, READ LIVE from `service_requests`.
 *
 * Nothing is copied into a calendar table: the dashboard and the calendar read
 * the same rows, so they cannot disagree about what a provider has to do.
 *
 * ⚠️ NO IMPORT OF THE service-requests MODULE. This module is a leaf; the read
 * is raw SQL over tables it does not own, with the statuses interpolated from
 * their enums (compile-time constants, never caller data). Precedent:
 * `ProfessionalServiceCategoryRepository.countActiveJobsForTrade`.
 *
 * GEO-SAFE: no geometry column is selected — neither `service_location` nor
 * `users.default_location`.
 */

/** What an appointment row carries before its timing is resolved. */
export interface CalendarEventRecord {
  id: string;
  status: ServiceRequestStatus;
  requestType: ServiceRequestType;
  /**
   * WHEN it happens — resolved in SQL, in ONE place ({@link ANCHOR_SQL}):
   * a direct booking is anchored on its retained start, a tender on the date
   * its accepted quote proposed. Null = nothing dates this job yet.
   */
  anchorAtUtc: Date | null;
  /** End of the window the client offered (direct booking). Information only. */
  desiredEndAtUtc: Date | null;
  /** Duration the provider lists for this service, if it still offers it. */
  serviceDurationMinutes: number | null;
  /** Duration announced in the accepted quote (tender). */
  quoteDurationMinutes: number | null;
  updatedAtUtc: Date;
  categoryNameTranslations: Record<string, string>;
  itemNameTranslations: Record<string, string> | null;
}

/** The same row, with what only the PROVIDER'S OWN calendar may show. */
export interface CalendarEventDetailRecord extends CalendarEventRecord {
  title: string;
  serviceAddress: string;
  /** Null when the client's account is gone (masked at the mapper, like the dashboard). */
  clientDisplayName: string | null;
}

interface BaseRow {
  id: string;
  status: ServiceRequestStatus;
  request_type: ServiceRequestType;
  anchor_at_utc: Date | null;
  desired_end_at_utc: Date | null;
  service_duration_minutes: number | null;
  quote_duration_minutes: number | null;
  updated_at_utc: Date;
  category_name_translations: Record<string, string>;
  item_name_translations: Record<string, string> | null;
}

interface DetailRow extends BaseRow {
  title: string;
  service_address: string;
  client_display_name: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  client_deleted_at_utc: Date | null;
}

/**
 * ⚠️ THE ONE RULE FOR « WHEN ». Read by the range filter AND returned as
 * `anchor_at_utc`; the TypeScript side never recomputes it.
 *
 * - DIRECT_BOOKING → `scheduled_at_utc` (the start the provider retained by
 *   accepting, §13.1 nº 15c), else the start of the window the client offered
 *   (a booking still OPEN has no scheduled time yet).
 * - PROJECT_TENDER → the start date proposed in the ACCEPTED quote. Never the
 *   request's own `desired_start_at_utc`: on a tender that is the client's
 *   indicative window, possibly weeks wide, and nothing was agreed on it.
 */
const ANCHOR_SQL = `
  CASE WHEN sr.request_type = '${ServiceRequestType.DIRECT_BOOKING}'
       THEN COALESCE(sr.scheduled_at_utc, sr.desired_start_at_utc)
       ELSE aq.proposed_start_at_utc
  END`;

/** Statuses of a job this provider holds and that belongs on a calendar. */
const JOB_STATUSES = [
  ServiceRequestStatus.ASSIGNED,
  ServiceRequestStatus.IN_PROGRESS,
  ServiceRequestStatus.COMPLETED,
  ServiceRequestStatus.PAID,
];

/** Statuses that still TAKE time ahead: the job is his and not done. */
export const BUSY_JOB_STATUSES: readonly ServiceRequestStatus[] = [
  ServiceRequestStatus.ASSIGNED,
  ServiceRequestStatus.IN_PROGRESS,
];

/**
 * Statuses whose TIMED entries remove time from the public availability
 * (decision of 17 November 2026): the jobs still ahead, AND a direct booking
 * still OPEN — the client asked for that hour, so it is not offered to a
 * second client while the provider has not answered. A pending booking never
 * blocks for long: its response deadline is min(desired start, now + 48 h),
 * and the 5-minute expiry sweep turns it EXPIRED once that passes.
 *
 * Only TIMED entries count — an accepted tender names a day, not an hour, and
 * blocks nothing (the provider adds a blocked period if he wants the day).
 */
export const AVAILABILITY_BLOCKING_STATUSES: readonly ServiceRequestStatus[] = [
  ServiceRequestStatus.OPEN,
  ...BUSY_JOB_STATUSES,
];

function inList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}

/**
 * Whose rows: jobs assigned to the provider, plus the direct bookings still
 * OPEN and aimed at it (shown as tentative). `$1` = the provider id.
 */
const OWNERSHIP_SQL = `
  sr.deleted_at_utc IS NULL
  AND (
    (sr.assigned_service_provider_id = $1 AND sr.status IN (${inList(JOB_STATUSES)}))
    OR (sr.requested_service_provider_id = $1
        AND sr.status = '${ServiceRequestStatus.OPEN}'
        AND sr.request_type = '${ServiceRequestType.DIRECT_BOOKING}')
  )`;

/**
 * Joins shared by both reads. Each LATERAL collapses to at most one row BEFORE
 * it can fan anything out:
 * - `aq`: the accepted quote of THIS provider (several ACCEPTED rows cannot
 *   exist, the ORDER BY only makes the pick deterministic);
 * - `svc`: the provider's own listing of the requested service, for its
 *   duration. A deleted listing no longer says anything; a paused one still does.
 */
const SHARED_JOINS = `
  JOIN service_categories sc ON sc.id = sr.service_category_id
  LEFT JOIN service_items si ON si.id = sr.service_item_id
  LEFT JOIN LATERAL (
    SELECT q.proposed_start_at_utc, q.estimated_duration_minutes
      FROM quotes q
     WHERE q.service_request_id = sr.id
       AND q.service_provider_id = $1
       AND q.status = '${QuoteStatus.ACCEPTED}'
     ORDER BY q.created_at_utc ASC, q.id ASC
     LIMIT 1
  ) aq ON true
  LEFT JOIN LATERAL (
    SELECT ps.estimated_duration_minutes
      FROM professional_services ps
      JOIN professional_service_categories psc
        ON psc.id = ps.professional_service_category_id
     WHERE psc.service_provider_id = $1
       AND ps.service_item_id = sr.service_item_id
       AND ps.deleted_at_utc IS NULL
     ORDER BY ps.created_at_utc DESC, ps.id DESC
     LIMIT 1
  ) svc ON true`;

const BASE_COLUMNS = `
  sr.id, sr.status, sr.request_type,
  ${ANCHOR_SQL} AS anchor_at_utc,
  sr.desired_end_at_utc,
  svc.estimated_duration_minutes AS service_duration_minutes,
  aq.estimated_duration_minutes AS quote_duration_minutes,
  sr.updated_at_utc,
  sc.name_translations AS category_name_translations,
  si.name_translations AS item_name_translations`;

/**
 * A dated event is kept when its anchor falls in `[$2 − 1 day, $3)`: the day
 * of slack covers an appointment that started before the window and runs into
 * it (a direct booking is at most 24 h wide). The caller clips precisely.
 */
const DATED_IN_RANGE_SQL = `
  (${ANCHOR_SQL}) >= ($2::timestamptz - interval '1 day')
  AND (${ANCHOR_SQL}) < $3::timestamptz`;

function mapBase(row: BaseRow): CalendarEventRecord {
  return {
    id: row.id,
    status: row.status,
    requestType: row.request_type,
    anchorAtUtc: row.anchor_at_utc,
    desiredEndAtUtc: row.desired_end_at_utc,
    serviceDurationMinutes:
      row.service_duration_minutes === null ? null : Number(row.service_duration_minutes),
    quoteDurationMinutes:
      row.quote_duration_minutes === null ? null : Number(row.quote_duration_minutes),
    updatedAtUtc: row.updated_at_utc,
    categoryNameTranslations: row.category_name_translations ?? {},
    itemNameTranslations: row.item_name_translations ?? null,
  };
}

function mapDetail(row: DetailRow): CalendarEventDetailRecord {
  const clientDeleted = row.client_deleted_at_utc !== null;
  const fullName = [row.client_first_name, row.client_last_name]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .trim();
  return {
    ...mapBase(row),
    title: row.title,
    serviceAddress: row.service_address,
    clientDisplayName: clientDeleted ? null : row.client_display_name || fullName || null,
  };
}

@Injectable()
export class CalendarEventsRepository {
  constructor(
    // Any repository gives access to `.query`; this module registers this one.
    @InjectRepository(ProviderCalendar)
    private readonly repo: Repository<ProviderCalendar>,
  ) {}

  /**
   * The provider's OWN view: dated appointments in the window, plus every job
   * still to do that nothing dates yet (whatever the window — « à planifier »
   * must not disappear when the provider looks at another week).
   *
   * Carries the title, the address and the client's name: the caller is the
   * assignee or the targeted provider, a named counterparty, exactly as on the
   * dashboard. Never coordinates, never the client's account id.
   */
  async findForOwner(
    providerId: string,
    fromUtc: Date,
    toUtc: Date,
  ): Promise<CalendarEventDetailRecord[]> {
    const rows: DetailRow[] = await this.repo.query(
      `SELECT ${BASE_COLUMNS},
              sr.title, sr.service_address,
              cu.display_name AS client_display_name,
              cu.first_name AS client_first_name,
              cu.last_name AS client_last_name,
              cu.deleted_at_utc AS client_deleted_at_utc
         FROM service_requests sr
         ${SHARED_JOINS}
         JOIN users cu ON cu.id = sr.client_user_id
        WHERE ${OWNERSHIP_SQL}
          AND (
            (${DATED_IN_RANGE_SQL})
            OR ((${ANCHOR_SQL}) IS NULL AND sr.status IN (${inList(BUSY_JOB_STATUSES)}))
          )
        ORDER BY anchor_at_utc ASC NULLS LAST, sr.id ASC`,
      [providerId, fromUtc, toUtc],
    );
    return rows.map(mapDetail);
  }

  /**
   * The lean read behind the public availability and the iCal feed: dated
   * appointments only, and NOTHING that identifies the client — no title, no
   * address, no name, and no join on `users` at all. What is not read cannot
   * be served by mistake.
   */
  async findDated(
    providerId: string,
    fromUtc: Date,
    toUtc: Date,
  ): Promise<CalendarEventRecord[]> {
    const rows: BaseRow[] = await this.repo.query(
      `SELECT ${BASE_COLUMNS}
         FROM service_requests sr
         ${SHARED_JOINS}
        WHERE ${OWNERSHIP_SQL}
          AND ${DATED_IN_RANGE_SQL}
        ORDER BY anchor_at_utc ASC, sr.id ASC`,
      [providerId, fromUtc, toUtc],
    );
    return rows.map(mapBase);
  }
}
