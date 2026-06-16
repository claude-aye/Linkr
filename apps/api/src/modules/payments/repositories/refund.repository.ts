import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Refund } from '../entities/refund.entity';
import { RefundStatus } from '../enums/refund-status.enum';

/** Domain record — snake_case columns mapped to camelCase. */
export interface RefundRecord {
  id: string;
  paymentId: string;
  amount: string;
  currency: string;
  reason: string;
  initiatedByUserId: string;
  status: RefundStatus;
  stripeRefundId: string | null;
  failureReason: string | null;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

export interface CreateRefundData {
  paymentId: string;
  amount: string;
  currency: string;
  reason: string;
  initiatedByUserId: string;
}

interface RawRow {
  id: string;
  payment_id: string;
  amount: string;
  currency: string;
  reason: string;
  initiated_by_user_id: string;
  status: RefundStatus;
  stripe_refund_id: string | null;
  failure_reason: string | null;
  created_at_utc: Date;
  updated_at_utc: Date;
}

const SELECT_COLUMNS = `
  id, payment_id, amount, currency, reason, initiated_by_user_id, status,
  stripe_refund_id, failure_reason, created_at_utc, updated_at_utc
`;

/**
 * TypeORM's raw `.query()` on the postgres driver returns `[rows, affected]`
 * for UPDATE statements (RETURNING populates `rows`) — unlike INSERT/SELECT,
 * which return the rows array directly. Normalize back to plain rows.
 */
function updateReturningRows(result: unknown): RawRow[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as RawRow[];
  }
  return (result as RawRow[]) ?? [];
}

function mapRow(row: RawRow): RefundRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    amount: row.amount,
    currency: row.currency,
    reason: row.reason,
    initiatedByUserId: row.initiated_by_user_id,
    status: row.status,
    stripeRefundId: row.stripe_refund_id,
    failureReason: row.failure_reason,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

@Injectable()
export class RefundRepository {
  constructor(
    @InjectRepository(Refund)
    private readonly repo: Repository<Refund>,
  ) {}

  async findById(id: string): Promise<RefundRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM refunds WHERE id = $1`,
      [id],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async findByStripeRefundId(
    stripeRefundId: string,
  ): Promise<RefundRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM refunds WHERE stripe_refund_id = $1`,
      [stripeRefundId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  /**
   * Amount already committed against a payment — PENDING (in flight) and
   * SUCCEEDED. The anti-over-refund guard requires
   * `requested <= gross - inFlight`.
   */
  async sumInFlightByPaymentId(paymentId: string): Promise<string> {
    const rows: Array<{ total: string }> = await this.repo.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM refunds
       WHERE payment_id = $1 AND status IN ('${RefundStatus.PENDING}', '${RefundStatus.SUCCEEDED}')`,
      [paymentId],
    );
    return rows[0].total;
  }

  /** Amount actually settled (SUCCEEDED) — drives the payment status derivation. */
  async sumSucceededByPaymentId(paymentId: string): Promise<string> {
    const rows: Array<{ total: string }> = await this.repo.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM refunds
       WHERE payment_id = $1 AND status = '${RefundStatus.SUCCEEDED}'`,
      [paymentId],
    );
    return rows[0].total;
  }

  /** Insert a refund row (status PENDING). */
  async create(data: CreateRefundData): Promise<RefundRecord> {
    const rows: RawRow[] = await this.repo.query(
      `INSERT INTO refunds
         (payment_id, amount, currency, reason, initiated_by_user_id, status)
       VALUES ($1, $2, $3, $4, $5, '${RefundStatus.PENDING}')
       RETURNING ${SELECT_COLUMNS}`,
      [
        data.paymentId,
        data.amount,
        data.currency,
        data.reason,
        data.initiatedByUserId,
      ],
    );
    return mapRow(rows[0]);
  }

  /** Persist the Stripe refund id + the status derived from its create result. */
  async attachStripe(
    refundId: string,
    stripeRefundId: string,
    status: RefundStatus,
  ): Promise<RefundRecord | null> {
    const rows = updateReturningRows(
      await this.repo.query(
        `UPDATE refunds
           SET stripe_refund_id = $2, status = $3, updated_at_utc = now()
         WHERE id = $1
         RETURNING ${SELECT_COLUMNS}`,
        [refundId, stripeRefundId, status],
      ),
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  /** Mark a refund FAILED (e.g. the Stripe create call threw). */
  async markFailed(
    refundId: string,
    failureReason: string,
  ): Promise<void> {
    await this.repo.query(
      `UPDATE refunds
         SET status = '${RefundStatus.FAILED}',
             failure_reason = $2,
             updated_at_utc = now()
       WHERE id = $1`,
      [refundId, failureReason],
    );
  }

  /**
   * Forward-only status advance driven by the webhook worker: only a still-
   * PENDING refund may move to a terminal status, so replays / out-of-order
   * deliveries are no-ops. Returns the (possibly unchanged) current record.
   */
  async advanceStatusByStripeId(
    stripeRefundId: string,
    status: RefundStatus,
    failureReason: string | null,
  ): Promise<RefundRecord | null> {
    await this.repo.query(
      `UPDATE refunds
         SET status = $2,
             failure_reason = COALESCE($3, failure_reason),
             updated_at_utc = now()
       WHERE stripe_refund_id = $1 AND status = '${RefundStatus.PENDING}'`,
      [stripeRefundId, status, failureReason],
    );
    return this.findByStripeRefundId(stripeRefundId);
  }
}
