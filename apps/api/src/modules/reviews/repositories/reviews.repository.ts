import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from '../entities/review.entity';

/** Everything needed to append one review. The provider is resolved server-side. */
export interface CreateReviewData {
  serviceRequestId: string;
  serviceProviderId: string;
  authorUserId: string;
  rating: number;
  comment: string | null;
}

/**
 * A review as its AUTHOR sees it, right after writing it.
 *
 * No `providerResponse`: the column exists (migration 1780520000000) but nothing
 * writes it until tranche 2, and a contract should not carry a field nothing can
 * fill.
 */
export interface ReviewRecord {
  id: string;
  serviceRequestId: string;
  serviceProviderId: string;
  rating: number;
  comment: string | null;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

/**
 * A review as a PUBLIC READER sees it, on a provider's profile.
 *
 * ⚠️ NO `authorUserId`, NO `serviceRequestId`, AND THAT IS DELIBERATE. This is
 * the first surface of the project that makes a client publicly legible — their
 * name, the fact that they bought a service, from whom, and when. What ships is
 * the minimum that makes a review credible: a rating, the author's own words, a
 * masked name and a date. The user id and the request id would add nothing a
 * reader can use and would link a person to a purchase across surfaces.
 *
 * The name parts travel raw and are masked BY THE MAPPER (first name + last
 * initial, D / brief §6) — the same place the codebase already masks a
 * soft-deleted client's name, and never a SQL filter.
 */
export interface ProviderReviewRecord {
  id: string;
  rating: number;
  comment: string | null;
  createdAtUtc: Date;
  authorFirstName: string | null;
  authorLastName: string | null;
  authorDeleted: boolean;
}

interface RawReviewRow {
  id: string;
  service_request_id: string;
  service_provider_id: string;
  rating: number;
  comment: string | null;
  created_at_utc: Date;
  updated_at_utc: Date;
}

interface RawProviderReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at_utc: Date;
  author_first_name: string | null;
  author_last_name: string | null;
  author_deleted: boolean | null;
  review_count: number;
  /** Already gated by the threshold IN SQL — null below it. See the query. */
  average_rating: number | null;
}

interface RawDeletedRow {
  id: string;
}

/**
 * TypeORM's raw `.query()` on the postgres driver returns `[rows, affected]`
 * for UPDATE statements (RETURNING populates `rows`) — unlike INSERT/SELECT,
 * which return the rows array directly. Normalize back to plain rows.
 *
 * Load-bearing here beyond shape: without it a zero-row UPDATE still yields a
 * two-element array, so "not the caller's review" would read as a hit and the
 * delete would answer 204 on someone else's row instead of 404. Same local copy
 * as the payment / refund / quote / stripe-connect / notifications repositories
 * — factoring the five into one shared helper is a tracked chore, not this PR.
 */
function updateReturningRows(result: unknown): RawDeletedRow[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as RawDeletedRow[];
  }
  return (result as RawDeletedRow[]) ?? [];
}

function mapRow(row: RawReviewRow): ReviewRecord {
  return {
    id: row.id,
    serviceRequestId: row.service_request_id,
    serviceProviderId: row.service_provider_id,
    rating: row.rating,
    comment: row.comment,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

const SELECT_COLUMNS = `
  r.id, r.service_request_id, r.service_provider_id,
  r.rating, r.comment, r.created_at_utc, r.updated_at_utc
`;

/**
 * PostgreSQL's unique-violation SQLSTATE. The partial unique index is the
 * backstop under the service's explicit "already reviewed" check: the check
 * gives a clean 409 on the ordinary path, this catches the race between two
 * simultaneous writes.
 */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * Below this many live reviews, NO average is returned — not a rounded one, not
 * a hidden one: the field is null (D-4).
 *
 * ⚠️ THE THRESHOLD IS APPLIED IN SQL, NOT IN THE MAPPER AND NOT IN THE FRONT.
 * An average on one review is not a statistic, it is an opinion in disguise, and
 * it condemns or oversells a tradesperson on a sample of one. Putting the rule
 * in the query means a caller that forgets it does not exist: the number never
 * leaves the database below the threshold, so no component can be tempted to
 * "just show it anyway", and the next caller inherits the rule for free.
 */
export const RATING_AVERAGE_MIN_REVIEWS = 3;

@Injectable()
export class ReviewsRepository {
  constructor(
    @InjectRepository(Review)
    private readonly repo: Repository<Review>,
  ) {}

  /**
   * Appends one review and returns it. No transaction: a single row is already
   * atomic and it has no sibling row it must land with.
   */
  async insertOne(data: CreateReviewData): Promise<ReviewRecord> {
    const rows: RawReviewRow[] = await this.repo.query(
      `INSERT INTO reviews
         (service_request_id, service_provider_id, author_user_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, service_request_id, service_provider_id,
                 rating, comment, created_at_utc, updated_at_utc`,
      [
        data.serviceRequestId,
        data.serviceProviderId,
        data.authorUserId,
        data.rating,
        data.comment,
      ],
    );
    return mapRow(rows[0]);
  }

  /** The live review of a request, if any. Soft-deleted rows are not "live". */
  async findActiveByRequestId(
    serviceRequestId: string,
  ): Promise<ReviewRecord | null> {
    const rows: RawReviewRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM reviews r
        WHERE r.service_request_id = $1 AND r.deleted_at_utc IS NULL`,
      [serviceRequestId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  /**
   * Soft-deletes a review, and only its author's.
   *
   * ⚠️ THE OWNERSHIP TEST IS IN THE `WHERE`, AND ZERO ROWS MUST MAP TO 404,
   * NEVER 403. A 403 would confirm that a given id is a real review belonging to
   * someone else, and there is nothing to gain by saying so — the same call the
   * notifications read already makes. Zero rows is therefore unambiguous:
   * unknown, already deleted, or not the caller's.
   *
   * ⚠️ THE REPLY GOES WITH IT, WITH NO CASCADE TO WRITE (D-3). Because the
   * provider's reply is a column on THIS row, hiding the row hides the reply —
   * there is no child table to sweep, and therefore none to forget. This is the
   * whole payoff of D-2's column-not-entity choice, and the reason this PR does
   * not grow the "soft delete cascading on 2 tables out of 20" debt.
   *
   * `updated_at_utc` is set by hand because raw SQL bypasses TypeORM's
   * `@UpdateDateColumn`, and the column default only fires on INSERT.
   */
  async softDeleteByAuthor(
    reviewId: string,
    authorUserId: string,
  ): Promise<boolean> {
    const rows = updateReturningRows(
      await this.repo.query(
        `UPDATE reviews r
            SET deleted_at_utc = now(), updated_at_utc = now()
          WHERE r.id = $1
            AND r.author_user_id = $2
            AND r.deleted_at_utc IS NULL
        RETURNING r.id`,
        [reviewId, authorUserId],
      ),
    );
    return rows.length > 0;
  }

  /**
   * A provider's reviews plus their aggregate, in ONE round trip.
   *
   * ⚠️ THE SOFT-DELETE EXCLUSION IS INSIDE THE AGGREGATE, NOT A FILTER THE
   * CALLER APPLIES. A caller that forgets it has to be impossible, not merely
   * discouraged (brief §5): both the list and the counts read the same
   * `deleted_at_utc IS NULL` predicate, in the same statement.
   *
   * ⚠️ `reviewCount` / `averageRating` RIDE ALONG AS WINDOW FUNCTIONS, which are
   * evaluated BEFORE `LIMIT` — so they describe the whole set and the cap cannot
   * make them lie. Zero rows ⇒ no row to read them from ⇒ count 0 and no
   * average, which is the right answer. Same pattern as
   * `NotificationsRepository.findForRecipient` and the demand-signal summary.
   *
   * ⚠️ THE D-4 THRESHOLD IS ENFORCED HERE, IN THE `CASE` — below
   * {@link RATING_AVERAGE_MIN_REVIEWS} live reviews the average is NULL on the
   * wire, not merely unrendered.
   *
   * `created_at_utc DESC, id DESC`: the tiebreaker is load-bearing, not
   * decoration — two reviews written in the same transaction-less second would
   * otherwise come back in an unstable order between two loads.
   *
   * The author join is LEFT and NOT filtered on `u.deleted_at_utc`: a review
   * outlives the account that wrote it (the FK is RESTRICT, so the row is never
   * gone), and the deletion is PROJECTED so the mapper can drop the name — the
   * codebase's established Loi 25 shape, never a SQL filter that would make the
   * review itself vanish and silently change the average.
   */
  async findByProviderWithAggregate(
    serviceProviderId: string,
    limit: number,
  ): Promise<{
    items: ProviderReviewRecord[];
    reviewCount: number;
    averageRating: number | null;
  }> {
    const rows: RawProviderReviewRow[] = await this.repo.query(
      `SELECT
         r.id,
         r.rating,
         r.comment,
         r.created_at_utc,
         u.first_name                      AS author_first_name,
         u.last_name                       AS author_last_name,
         (u.deleted_at_utc IS NOT NULL)    AS author_deleted,
         (COUNT(*) OVER ())::int           AS review_count,
         CASE WHEN COUNT(*) OVER () >= ${RATING_AVERAGE_MIN_REVIEWS}
              THEN (ROUND(AVG(r.rating) OVER (), 2))::float8
         END                               AS average_rating
       FROM reviews r
       LEFT JOIN users u ON u.id = r.author_user_id
       WHERE r.service_provider_id = $1
         AND r.deleted_at_utc IS NULL
       ORDER BY r.created_at_utc DESC, r.id DESC
       LIMIT $2`,
      [serviceProviderId, limit],
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        comment: row.comment,
        createdAtUtc: row.created_at_utc,
        authorFirstName: row.author_first_name,
        authorLastName: row.author_last_name,
        authorDeleted: row.author_deleted === true,
      })),
      reviewCount: rows.length ? rows[0].review_count : 0,
      averageRating: rows.length ? rows[0].average_rating : null,
    };
  }
}
