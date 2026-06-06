import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Quote } from '../entities/quote.entity';
import { QuoteStatus } from '../enums/quote-status.enum';

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
   * accepted. Returns the number of siblings rejected.
   */
  async rejectSiblings(
    serviceRequestId: string,
    acceptedQuoteId: string,
    manager: EntityManager,
  ): Promise<number> {
    const result = await manager.query(
      `UPDATE quotes SET status = '${QuoteStatus.REJECTED}', updated_at_utc = now()
       WHERE service_request_id = $1
         AND id <> $2
         AND status = '${QuoteStatus.SUBMITTED}'
       RETURNING id`,
      [serviceRequestId, acceptedQuoteId],
    );
    return affectedCount(result);
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
