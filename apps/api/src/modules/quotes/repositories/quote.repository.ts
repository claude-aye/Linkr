import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Quote } from '../entities/quote.entity';
import { QuoteStatus } from '../enums/quote-status.enum';
import { ProviderType } from '../../service-providers/enums/provider-type.enum';
import { PscVerificationStatus } from '../../service-providers/enums/psc-verification-status.enum';
import { PROVIDER_DISPLAY_NAME_SQL } from '../../service-providers/repositories/display-name.sql';

export interface QuoteRecord {
  id: string;
  serviceRequestId: string;
  serviceProviderId: string;
  amount: string;
  currency: string;
  estimatedDurationMinutes: number;
  proposedStartAtUtc: Date | null;
  description: string;
  status: QuoteStatus;
  validUntilUtc: Date;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

export interface CreateQuoteData {
  serviceRequestId: string;
  serviceProviderId: string;
  amount: string;
  currency: string;
  estimatedDurationMinutes: number;
  proposedStartAtUtc: Date | null;
  description: string;
  validUntilUtc: Date;
}

interface RawQuoteRow {
  id: string;
  service_request_id: string;
  service_provider_id: string;
  amount: string;
  currency: string;
  estimated_duration_minutes: number;
  proposed_start_at_utc: Date | null;
  description: string;
  status: QuoteStatus;
  valid_until_utc: Date;
  created_at_utc: Date;
  updated_at_utc: Date;
}

/**
 * One quote received on a tender, joined with what the client needs to compare
 * it: who sent it, how that provider stands on this trade, and how far away he
 * is. Identity fields are RAW here (not yet masked): the provider's
 * `deleted_at_utc` travels with them so the mapper can blank them.
 */
export interface ReceivedQuoteRecord {
  id: string;
  amount: string;
  currency: string;
  estimatedDurationMinutes: number;
  proposedStartAtUtc: Date | null;
  description: string;
  status: QuoteStatus;
  validUntilUtc: Date;
  createdAtUtc: Date;
  serviceProviderId: string;
  providerType: ProviderType;
  providerUserId: string | null;
  providerIsActive: boolean;
  providerDeletedAtUtc: Date | null;
  /**
   * Connect mirror row exists AND charges_enabled. No row ⇒ false — the same
   * rule as `PaymentsService.isProviderChargeable`, which `accept` reads.
   */
  providerChargesEnabled: boolean;
  /**
   * The provider still holds the request's trade — the predicate of
   * `ProfessionalServiceCategoryRepository.isEligibleForCategory`, which
   * `accept` reads. Never null: EXISTS answers true or false.
   */
  providerEligibleForCategory: boolean;
  providerDisplayName: string | null;
  providerHeadline: string | null;
  /** Null when the claim on the trade no longer exists (or is soft-deleted). */
  verificationStatus: PscVerificationStatus | null;
  /** Metres, provider base → tender point. Null if either point is missing. */
  distanceMeters: number | null;
}

interface RawReceivedQuoteRow {
  id: string;
  amount: string;
  currency: string;
  estimated_duration_minutes: number;
  proposed_start_at_utc: Date | null;
  description: string;
  status: QuoteStatus;
  valid_until_utc: Date;
  created_at_utc: Date;
  service_provider_id: string;
  provider_type: ProviderType;
  provider_user_id: string | null;
  provider_is_active: boolean;
  provider_deleted_at_utc: Date | null;
  provider_charges_enabled: boolean;
  provider_eligible_for_category: boolean;
  provider_display_name: string | null;
  provider_headline: string | null;
  verification_status: PscVerificationStatus | null;
  distance_meters: string | number | null;
}

const SELECT_COLUMNS = `
  id, service_request_id, service_provider_id, amount, currency,
  estimated_duration_minutes, proposed_start_at_utc, description,
  status, valid_until_utc, created_at_utc, updated_at_utc
`;

/**
 * TypeORM's raw `.query()` on the postgres driver returns `[rows, affected]`
 * for UPDATE/DELETE statements (RETURNING populates `rows`) — unlike INSERT,
 * which returns the rows array directly. Normalize to the affected-row count.
 */
function affectedCount(result: unknown): number {
  if (Array.isArray(result)) {
    const [rows, affected] = result as [unknown, unknown];
    if (typeof affected === 'number') return affected;
    if (Array.isArray(rows)) return rows.length;
  }
  return 0;
}

/**
 * The rows an `UPDATE … RETURNING` touched. Same `[rows, affected]` quirk as
 * above, read the other way: here the ROWS are the answer, not the count.
 *
 * ⚠️ A naive `result.length` would read 2 on zero rows — and here that would
 * mean emailing two phantom recipients. Local copy of the normaliser the other
 * repositories carry (`updateReturningRows`); the shared helper is a chore.
 */
function updateReturningRows<TRow>(result: unknown): TRow[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as TRow[];
  }
  return (result as TRow[]) ?? [];
}

/** A sibling quote this accept flipped from SUBMITTED to REJECTED. */
export interface RejectedSibling {
  quoteId: string;
  serviceProviderId: string;
}

function mapRow(row: RawQuoteRow): QuoteRecord {
  return {
    id: row.id,
    serviceRequestId: row.service_request_id,
    serviceProviderId: row.service_provider_id,
    amount: row.amount,
    currency: row.currency,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    proposedStartAtUtc: row.proposed_start_at_utc,
    description: row.description,
    status: row.status,
    validUntilUtc: row.valid_until_utc,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

@Injectable()
export class QuoteRepository {
  constructor(
    @InjectRepository(Quote)
    private readonly repo: Repository<Quote>,
  ) {}

  async findById(id: string): Promise<QuoteRecord | null> {
    const rows: RawQuoteRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM quotes WHERE id = $1`,
      [id],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  /** Locked read (SELECT ... FOR UPDATE) for the acceptance transaction. */
  async findByIdForUpdate(
    id: string,
    manager: EntityManager,
  ): Promise<QuoteRecord | null> {
    const rows: RawQuoteRow[] = await manager.query(
      `SELECT ${SELECT_COLUMNS} FROM quotes WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findByRequestId(serviceRequestId: string): Promise<QuoteRecord[]> {
    const rows: RawQuoteRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM quotes
       WHERE service_request_id = $1
       ORDER BY created_at_utc DESC`,
      [serviceRequestId],
    );
    return rows.map(mapRow);
  }

  async findByRequestIdAndProvider(
    serviceRequestId: string,
    serviceProviderId: string,
  ): Promise<QuoteRecord[]> {
    const rows: RawQuoteRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM quotes
       WHERE service_request_id = $1 AND service_provider_id = $2
       ORDER BY created_at_utc DESC`,
      [serviceRequestId, serviceProviderId],
    );
    return rows.map(mapRow);
  }

  async findByProviderId(serviceProviderId: string): Promise<QuoteRecord[]> {
    const rows: RawQuoteRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM quotes
       WHERE service_provider_id = $1
       ORDER BY created_at_utc DESC`,
      [serviceProviderId],
    );
    return rows.map(mapRow);
  }

  /**
   * The quotes a tender has received, as its client compares them
   * (`GET /service-requests/:id/received-quotes`). Every status but WITHDRAWN.
   *
   * ⚠️ THE PROVIDER JOIN DOES NOT FILTER `deleted_at_utc`, AND THAT IS THE
   * DECISION. A quote is never hidden from the client because its sender left:
   * the client must see the real number of offers he received. The row stays,
   * the mapper blanks the identity, and `acceptable` says it cannot be taken.
   * INNER is safe: `quotes.service_provider_id` is a NOT NULL FK and providers
   * are only ever soft-deleted, so the row always exists.
   *
   * ⚠️ THE CLAIM ON THE TRADE IS A LEFT JOIN WITH ITS DELETION TEST IN THE `ON`.
   * Put in the `WHERE`, it would drop the quote of a provider who withdrew his
   * claim — the same disappearance, by another door. At most one live row can
   * match (`ux_psc_provider_category_active`), so the join cannot fan out.
   *
   * ⚠️ WITHDRAWN IS EXCLUDED, AND ONLY IT: a withdrawn quote is the provider
   * taking his offer back, not an offer the client received and lost.
   *
   * Order: live offers first, then arrival. NEVER by price or by rating — the
   * API does not rank providers.
   *
   * `sr.service_location::geography` — same cast, same reason as the tender
   * feed (`eligibility.sql.ts`): without it `ST_Distance` resolves to its
   * geometry overload and returns DEGREES.
   */
  async findReceivedForRequest(
    serviceRequestId: string,
  ): Promise<ReceivedQuoteRecord[]> {
    const rows: RawReceivedQuoteRow[] = await this.repo.query(
      `SELECT
         q.id, q.amount, q.currency, q.estimated_duration_minutes,
         q.proposed_start_at_utc, q.description, q.status, q.valid_until_utc,
         q.created_at_utc, q.service_provider_id,
         sp.provider_type,
         sp.user_id        AS provider_user_id,
         sp.is_active      AS provider_is_active,
         sp.deleted_at_utc AS provider_deleted_at_utc,
         COALESCE(sca.charges_enabled, false) AS provider_charges_enabled,
         -- ⚠️ A WORD-FOR-WORD COPY of \`isEligibleForCategory\` (the read
         -- \`accept\` makes), deliberately INDEPENDENT of the claim LEFT JOIN
         -- below: that join filters neither \`is_active\` nor the status (it
         -- feeds the badge), this one must. One EXISTS per row, in this ONE statement —
         -- never a read per quote. \`quote-eligibility.probe.ts\` proves the
         -- two agree case by case.
         EXISTS (
           SELECT 1
             FROM professional_service_categories pe
            WHERE pe.service_provider_id = sp.id
              AND pe.service_category_id = sr.service_category_id
              AND pe.is_active = true
              AND pe.deleted_at_utc IS NULL
              AND pe.verification_status IN ('${PscVerificationStatus.VERIFIED}', '${PscVerificationStatus.NOT_REQUIRED}')
         ) AS provider_eligible_for_category,
         ${PROVIDER_DISPLAY_NAME_SQL} AS provider_display_name,
         sp.headline       AS provider_headline,
         psc.verification_status,
         ST_Distance(sp.service_base_location, sr.service_location::geography)
                           AS distance_meters
       FROM quotes q
       INNER JOIN service_requests sr ON sr.id = q.service_request_id
       INNER JOIN service_providers sp ON sp.id = q.service_provider_id
       LEFT JOIN professional_service_categories psc
         ON psc.service_provider_id = sp.id
        AND psc.service_category_id = sr.service_category_id
        AND psc.deleted_at_utc IS NULL
       -- UNIQUE(service_provider_id): at most one row, no fan-out. LEFT, never
       -- INNER — a provider without a Connect row keeps its quote listed, and
       -- COALESCE reads the missing row as "not chargeable".
       LEFT JOIN stripe_connect_accounts sca
         ON sca.service_provider_id = sp.id
       WHERE q.service_request_id = $1
         AND q.status <> '${QuoteStatus.WITHDRAWN}'
       ORDER BY
         (CASE WHEN q.status = '${QuoteStatus.SUBMITTED}' THEN 0 ELSE 1 END),
         q.created_at_utc ASC,
         q.id ASC`,
      [serviceRequestId],
    );
    return rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      currency: row.currency,
      estimatedDurationMinutes: row.estimated_duration_minutes,
      proposedStartAtUtc: row.proposed_start_at_utc,
      description: row.description,
      status: row.status,
      validUntilUtc: row.valid_until_utc,
      createdAtUtc: row.created_at_utc,
      serviceProviderId: row.service_provider_id,
      providerType: row.provider_type,
      providerUserId: row.provider_user_id,
      providerIsActive: row.provider_is_active,
      providerDeletedAtUtc: row.provider_deleted_at_utc,
      providerChargesEnabled: row.provider_charges_enabled,
      providerEligibleForCategory: row.provider_eligible_for_category,
      providerDisplayName: row.provider_display_name,
      providerHeadline: row.provider_headline,
      verificationStatus: row.verification_status,
      distanceMeters:
        row.distance_meters === null ? null : Number(row.distance_meters),
    }));
  }

  async create(data: CreateQuoteData): Promise<QuoteRecord> {
    const rows: Array<{ id: string }> = await this.repo.query(
      `INSERT INTO quotes (
         service_request_id, service_provider_id, amount, currency,
         estimated_duration_minutes, proposed_start_at_utc, description,
         status, valid_until_utc
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        data.serviceRequestId,
        data.serviceProviderId,
        data.amount,
        data.currency,
        data.estimatedDurationMinutes,
        data.proposedStartAtUtc ?? null,
        data.description,
        QuoteStatus.SUBMITTED,
        data.validUntilUtc,
      ],
    );

    const created = await this.findById(rows[0].id);
    if (!created) throw new Error('Quote insert succeeded but read-back failed');
    return created;
  }

  async updateStatus(
    id: string,
    status: QuoteStatus,
    manager?: EntityManager,
  ): Promise<void> {
    const sql = `UPDATE quotes SET status = $1, updated_at_utc = now() WHERE id = $2`;
    if (manager) {
      await manager.query(sql, [status, id]);
    } else {
      await this.repo.query(sql, [status, id]);
    }
  }

  /**
   * Bulk-reject the other live (SUBMITTED) quotes of a request when one is
   * accepted. Returns the siblings THIS statement transitioned — not a count.
   *
   * ⚠️ THE LIST IS THE RECIPIENT LIST of the « not selected » email, and the
   * `status = SUBMITTED` predicate is what makes it right: a quote already
   * WITHDRAWN or EXPIRED is not in it, so its provider — who had already left
   * the race — is never told "the client chose someone else". Reading the
   * recipients from anywhere else (every quote of the request, every provider
   * who ever quoted) would lose that, silently.
   *
   * At most one SUBMITTED quote per provider per request
   * (`uq_quote_one_live_per_provider_per_request`), so a provider appears here
   * at most once — no dedupe needed.
   */
  async rejectSiblings(
    serviceRequestId: string,
    acceptedQuoteId: string,
    manager: EntityManager,
  ): Promise<RejectedSibling[]> {
    const result = await manager.query(
      `UPDATE quotes SET status = '${QuoteStatus.REJECTED}', updated_at_utc = now()
       WHERE service_request_id = $1
         AND id <> $2
         AND status = '${QuoteStatus.SUBMITTED}'
       RETURNING id, service_provider_id`,
      [serviceRequestId, acceptedQuoteId],
    );
    return updateReturningRows<{ id: string; service_provider_id: string }>(result).map(
      (row) => ({ quoteId: row.id, serviceProviderId: row.service_provider_id }),
    );
  }

  /**
   * Hourly sweep: bulk-expire SUBMITTED quotes whose validity window has
   * elapsed. Returns the number of quotes transitioned to EXPIRED.
   */
  async expireOverdue(manager?: EntityManager): Promise<number> {
    const sql = `
      UPDATE quotes SET status = '${QuoteStatus.EXPIRED}', updated_at_utc = now()
      WHERE status = '${QuoteStatus.SUBMITTED}' AND valid_until_utc < now()
      RETURNING id
    `;
    const result = manager ? await manager.query(sql) : await this.repo.query(sql);
    return affectedCount(result);
  }
}
