import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ProviderType } from '../../service-providers/enums/provider-type.enum';
import { ServiceRequestStatus } from '../../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../../service-requests/enums/service-request-type.enum';
import { Notification } from '../entities/notification.entity';
import { NotificationType } from '../enums/notification-type.enum';

/**
 * Exactly one of the two recipients is set — the database enforces it
 * (`chk_notifications_single_recipient`). Both are required fields rather than
 * optional ones so that a new call site has to state which kind of recipient it
 * is addressing, instead of silently defaulting to neither.
 */
export interface CreateNotificationData {
  recipientServiceProviderId: string | null;
  recipientUserId: string | null;
  type: NotificationType;
  serviceRequestId: string | null;
  data: Record<string, unknown> | null;
}

/**
 * One notification as the reader sees it: the row plus the labels joined from
 * the service request it points at. Every `serviceRequest*` field is nullable —
 * the join is a LEFT JOIN and `service_request_id` is itself nullable.
 *
 * No location field: `service_requests` has no city column (only the free-text
 * `service_address`), and a NEW_TENDER_MATCH recipient is a geographic match,
 * not the assignee — see the class comment on NotificationItemDto.
 */
export interface NotificationRecord {
  id: string;
  type: NotificationType;
  readAtUtc: Date | null;
  createdAtUtc: Date;
  data: Record<string, unknown> | null;
  serviceRequestId: string | null;
  // ── Joined from service_requests (LEFT) ────────────────────────────────────
  serviceRequestTitle: string | null;
  serviceRequestStatus: ServiceRequestStatus | null;
  serviceRequestType: ServiceRequestType | null;
  serviceRequestDeleted: boolean;
  serviceCategoryNameTranslations: Record<string, string> | null;
}

/**
 * Which notifications a user may read: those addressed to them personally, plus
 * those addressed to a provider profile they own.
 *
 * The provider set is resolved IN SQL rather than by a prior round trip, and it
 * mirrors `ServiceProviderRepository.findByUserId` verbatim (INDIVIDUAL,
 * non-deleted, paused providers included) — one predicate, one query. `IN`
 * rather than `=` so the set semantics generalise the day a user can own more
 * than one profile; today at most one row can match.
 *
 * ⚠️ ORGANIZATION providers are OUT of the set, deliberately. No backend path
 * resolves user → the ORGANIZATION providers they own (ownership is only ever
 * checked in the opposite direction, provider → membership, in
 * `ServiceProvidersService.assertActiveOwner`). Inventing that resolution here
 * would be a second, weaker opinion on organisation RBAC. Tracked as debt in
 * CLAUDE.md §6.
 *
 * `$1` is the caller's user id in BOTH queries below — mark-as-read passes its
 * parameters in that order on purpose, so this string is reusable verbatim and
 * the read surface and the write surface cannot drift apart.
 */
const RECIPIENT_PREDICATE = `(
  n.recipient_user_id = $1
  OR n.recipient_service_provider_id IN (
    SELECT sp.id FROM service_providers sp
     WHERE sp.user_id = $1
       AND sp.provider_type = '${ProviderType.INDIVIDUAL}'
       AND sp.deleted_at_utc IS NULL
  )
)`;

interface RawNotificationRow {
  id: string;
  type: NotificationType;
  read_at_utc: Date | null;
  created_at_utc: Date;
  data: Record<string, unknown> | null;
  service_request_id: string | null;
  service_request_title: string | null;
  service_request_status: ServiceRequestStatus | null;
  service_request_type: ServiceRequestType | null;
  service_request_deleted: boolean | null;
  service_category_name_translations: Record<string, string> | null;
  unread_count: string;
  total_count: string;
}

interface RawReadRow {
  id: string;
  read_at_utc: Date;
}

/**
 * TypeORM's raw `.query()` on the postgres driver returns `[rows, affected]`
 * for UPDATE statements (RETURNING populates `rows`) — unlike INSERT/SELECT,
 * which return the rows array directly. Normalize back to plain rows.
 *
 * Load-bearing here beyond shape: without it, a zero-row UPDATE still yields a
 * two-element array, so "not the caller's notification" would read as a hit and
 * answer 200 on someone else's row instead of 404. Same local helper as
 * payment / refund / quote / stripe-connect repositories — each carries its own
 * copy; factoring them into one is a separate chore.
 */
function updateReturningRows(result: unknown): RawReadRow[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as RawReadRow[];
  }
  return (result as RawReadRow[]) ?? [];
}

function mapRow(row: RawNotificationRow): NotificationRecord {
  return {
    id: row.id,
    type: row.type,
    readAtUtc: row.read_at_utc,
    createdAtUtc: row.created_at_utc,
    data: row.data,
    serviceRequestId: row.service_request_id,
    serviceRequestTitle: row.service_request_title,
    serviceRequestStatus: row.service_request_status,
    serviceRequestType: row.service_request_type,
    serviceRequestDeleted: row.service_request_deleted === true,
    serviceCategoryNameTranslations: row.service_category_name_translations,
  };
}

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  /** Batch-insert notifications inside the provided transaction manager. */
  async insertBatch(
    items: CreateNotificationData[],
    manager: EntityManager,
  ): Promise<void> {
    if (items.length === 0) return;

    const notifRepo = manager.getRepository(Notification);
    const entities = items.map((item) => this.toEntity(notifRepo, item));

    await notifRepo.save(entities);
  }

  /**
   * Insert a single notification. No transaction: one row is already atomic,
   * and unlike {@link insertBatch} there is no sibling row it has to land with.
   */
  async insertOne(item: CreateNotificationData): Promise<void> {
    await this.repo.save(this.toEntity(this.repo, item));
  }

  /**
   * The unified read: every notification addressed to the user or to a provider
   * profile they own, newest first, capped at `limit`.
   *
   * ONE round trip, by construction:
   *  • the two recipient branches are a single OR — never two queries summed in
   *    memory, which could not be ordered or capped coherently anyway;
   *  • `unreadCount` / `total` ride along as window functions. Windows are
   *    evaluated BEFORE LIMIT, so both count the whole matching set, not the
   *    page — a badge computed on the page would under-count the moment the cap
   *    truncates. Zero rows ⇒ no row to read them from ⇒ both are 0, which is
   *    the right answer.
   *
   * The joins are LEFT by decision, not by default: an INNER join would make
   * rows vanish silently — for a cancelled or soft-deleted request, or a
   * notification carrying no request at all. `sr.deleted_at_utc` is therefore
   * NOT filtered; it is projected, so the reader can say what happened instead
   * of showing a badge that leads nowhere.
   *
   * `created_at_utc DESC, id DESC`: the tiebreaker is load-bearing, not
   * decoration — `broadcastTenderMatch` inserts its whole fan-out in one
   * transaction, so those rows share a `now()` to the microsecond and would
   * otherwise come back in an unstable order.
   */
  async findForRecipient(
    userId: string,
    limit: number,
  ): Promise<{ items: NotificationRecord[]; unreadCount: number; total: number }> {
    const rows: RawNotificationRow[] = await this.repo.query(
      `SELECT
         n.id,
         n.type,
         n.read_at_utc,
         n.created_at_utc,
         n.data,
         n.service_request_id,
         sr.title                       AS service_request_title,
         sr.status                      AS service_request_status,
         sr.request_type                AS service_request_type,
         (sr.deleted_at_utc IS NOT NULL) AS service_request_deleted,
         sc.name_translations           AS service_category_name_translations,
         COUNT(*) FILTER (WHERE n.read_at_utc IS NULL) OVER () AS unread_count,
         COUNT(*) OVER ()                                      AS total_count
       FROM notifications n
       LEFT JOIN service_requests sr ON sr.id = n.service_request_id
       LEFT JOIN service_categories sc ON sc.id = sr.service_category_id
       WHERE n.deleted_at_utc IS NULL
         AND ${RECIPIENT_PREDICATE}
       ORDER BY n.created_at_utc DESC, n.id DESC
       LIMIT $2`,
      [userId, limit],
    );

    return {
      items: rows.map(mapRow),
      unreadCount: rows.length ? parseInt(rows[0].unread_count, 10) : 0,
      total: rows.length ? parseInt(rows[0].total_count, 10) : 0,
    };
  }

  /**
   * Stamp `read_at_utc`, idempotently, in a single statement.
   *
   * `COALESCE` is what makes it idempotent: an already-read row keeps its
   * original timestamp instead of having it rewritten, and `updated_at_utc` is
   * only moved when the read actually happened — a repeat call writes the exact
   * same values it found. That in turn keeps "zero rows" unambiguous: it can
   * only mean the notification does not exist, is soft-deleted, or is not the
   * caller's — never "already read". The caller maps that single case to 404.
   *
   * `updated_at_utc` is set by hand because raw SQL bypasses TypeORM's
   * `@UpdateDateColumn`, and the column default only fires on INSERT.
   */
  async markRead(
    notificationId: string,
    userId: string,
  ): Promise<{ id: string; readAtUtc: Date } | null> {
    const rows = updateReturningRows(
      await this.repo.query(
        `UPDATE notifications n
          SET read_at_utc = COALESCE(n.read_at_utc, now()),
              updated_at_utc = CASE
                WHEN n.read_at_utc IS NULL THEN now() ELSE n.updated_at_utc
              END
        WHERE n.id = $2
          AND n.deleted_at_utc IS NULL
          AND ${RECIPIENT_PREDICATE}
        RETURNING n.id, n.read_at_utc`,
        [userId, notificationId],
      ),
    );

    return rows.length ? { id: rows[0].id, readAtUtc: rows[0].read_at_utc } : null;
  }

  private toEntity(
    notifRepo: Repository<Notification>,
    item: CreateNotificationData,
  ): Notification {
    const n = notifRepo.create();
    n.recipientServiceProviderId = item.recipientServiceProviderId;
    n.recipientUserId = item.recipientUserId;
    n.type = item.type;
    n.serviceRequestId = item.serviceRequestId;
    n.data = item.data;
    n.readAtUtc = null;
    return n;
  }
}
