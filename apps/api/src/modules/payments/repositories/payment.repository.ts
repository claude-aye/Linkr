import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { PaymentType } from '../enums/payment-type.enum';
import { PaymentStatus } from '../enums/payment-status.enum';

/** Domain record — snake_case columns mapped to camelCase. */
export interface PaymentRecord {
  id: string;
  serviceRequestId: string;
  paymentType: PaymentType;
  payerUserId: string;
  payerOrganizationId: string | null;
  recipientServiceProviderId: string;
  paymentMethodId: string;
  stripePaymentIntentId: string | null;
  status: PaymentStatus;
  grossAmount: string;
  currency: string;
  commissionRatePercent: string | null;
  platformFeeAmount: string;
  taxAmount: string;
  providerNetAmount: string;
  capturedAtUtc: Date | null;
  failedAtUtc: Date | null;
  failureReason: string | null;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

export interface CreatePaymentData {
  serviceRequestId: string;
  paymentType: PaymentType;
  payerUserId: string;
  payerOrganizationId?: string | null;
  recipientServiceProviderId: string;
  paymentMethodId: string;
  status?: PaymentStatus;
  grossAmount: string;
  currency: string;
  commissionRatePercent: string | null;
  platformFeeAmount: string;
  taxAmount: string;
  providerNetAmount: string;
}

interface RawRow {
  id: string;
  service_request_id: string;
  payment_type: PaymentType;
  payer_user_id: string;
  payer_organization_id: string | null;
  recipient_service_provider_id: string;
  payment_method_id: string;
  stripe_payment_intent_id: string | null;
  status: PaymentStatus;
  gross_amount: string;
  currency: string;
  commission_rate_percent: string | null;
  platform_fee_amount: string;
  tax_amount: string;
  provider_net_amount: string;
  captured_at_utc: Date | null;
  failed_at_utc: Date | null;
  failure_reason: string | null;
  created_at_utc: Date;
  updated_at_utc: Date;
}

const SELECT_COLUMNS = `
  id, service_request_id, payment_type, payer_user_id, payer_organization_id,
  recipient_service_provider_id, payment_method_id, stripe_payment_intent_id,
  status, gross_amount, currency, commission_rate_percent, platform_fee_amount,
  tax_amount, provider_net_amount, captured_at_utc, failed_at_utc, failure_reason,
  created_at_utc, updated_at_utc
`;

/**
 * Statuses that must never be downgraded by a (possibly out-of-order, replayed)
 * webhook. Capture/refund/cancel outcomes are final.
 */
const TERMINAL_STATUSES = [
  PaymentStatus.SUCCEEDED,
  PaymentStatus.REFUNDED,
  PaymentStatus.CANCELLED,
  PaymentStatus.PARTIALLY_REFUNDED,
];

function mapRow(row: RawRow): PaymentRecord {
  return {
    id: row.id,
    serviceRequestId: row.service_request_id,
    paymentType: row.payment_type,
    payerUserId: row.payer_user_id,
    payerOrganizationId: row.payer_organization_id,
    recipientServiceProviderId: row.recipient_service_provider_id,
    paymentMethodId: row.payment_method_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    status: row.status,
    grossAmount: row.gross_amount,
    currency: row.currency,
    commissionRatePercent: row.commission_rate_percent,
    platformFeeAmount: row.platform_fee_amount,
    taxAmount: row.tax_amount,
    providerNetAmount: row.provider_net_amount,
    capturedAtUtc: row.captured_at_utc,
    failedAtUtc: row.failed_at_utc,
    failureReason: row.failure_reason,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

/** SQL list literal of terminal statuses, e.g. 'SUCCEEDED','REFUNDED',... */
const TERMINAL_SQL = TERMINAL_STATUSES.map((s) => `'${s}'`).join(', ');

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

@Injectable()
export class PaymentRepository {
  constructor(
    @InjectRepository(Payment)
    private readonly repo: Repository<Payment>,
  ) {}

  async findByServiceRequestAndType(
    serviceRequestId: string,
    paymentType: PaymentType,
  ): Promise<PaymentRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM payments
       WHERE service_request_id = $1 AND payment_type = $2`,
      [serviceRequestId, paymentType],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async create(
    data: CreatePaymentData,
    manager?: EntityManager,
  ): Promise<PaymentRecord> {
    const runner = manager ?? this.repo;
    const rows: RawRow[] = await runner.query(
      `INSERT INTO payments (
         service_request_id, payment_type, payer_user_id, payer_organization_id,
         recipient_service_provider_id, payment_method_id, status,
         gross_amount, currency, commission_rate_percent,
         platform_fee_amount, tax_amount, provider_net_amount
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
       ) RETURNING ${SELECT_COLUMNS}`,
      [
        data.serviceRequestId,
        data.paymentType,
        data.payerUserId,
        data.payerOrganizationId ?? null,
        data.recipientServiceProviderId,
        data.paymentMethodId,
        data.status ?? PaymentStatus.PENDING,
        data.grossAmount,
        data.currency,
        data.commissionRatePercent,
        data.platformFeeAmount,
        data.taxAmount,
        data.providerNetAmount,
      ],
    );
    return mapRow(rows[0]);
  }

  /** Persist the created PaymentIntent id + the status derived from its result. */
  async attachIntent(
    paymentId: string,
    stripePaymentIntentId: string,
    status: PaymentStatus,
    capturedAtUtc: Date | null,
  ): Promise<PaymentRecord | null> {
    const rows = updateReturningRows(
      await this.repo.query(
        `UPDATE payments
         SET stripe_payment_intent_id = $2,
             status = $3,
             captured_at_utc = COALESCE(captured_at_utc, $4),
             updated_at_utc = now()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
        [paymentId, stripePaymentIntentId, status, capturedAtUtc],
      ),
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  /** Record a capture failure (and the intent id, if Stripe produced one). */
  async recordFailure(
    paymentId: string,
    failureReason: string,
    stripePaymentIntentId: string | null,
  ): Promise<void> {
    await this.repo.query(
      `UPDATE payments
         SET status = '${PaymentStatus.FAILED}',
             failed_at_utc = now(),
             failure_reason = $2,
             stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $3),
             updated_at_utc = now()
       WHERE id = $1`,
      [paymentId, failureReason, stripePaymentIntentId],
    );
  }

  /**
   * Forward-only status transitions driven by the webhook worker. Each is a
   * conditional UPDATE that refuses to regress a terminal status, so they are
   * idempotent and safe under at-least-once / out-of-order delivery. Returns
   * the updated row, or null when the guard blocked it / no intent matched.
   */
  async markSucceededByIntentId(
    stripePaymentIntentId: string,
  ): Promise<PaymentRecord | null> {
    const rows = updateReturningRows(
      await this.repo.query(
        `UPDATE payments
           SET status = '${PaymentStatus.SUCCEEDED}',
               captured_at_utc = COALESCE(captured_at_utc, now()),
               updated_at_utc = now()
         WHERE stripe_payment_intent_id = $1
           AND status NOT IN (${TERMINAL_SQL})
         RETURNING ${SELECT_COLUMNS}`,
        [stripePaymentIntentId],
      ),
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async markFailedByIntentId(
    stripePaymentIntentId: string,
    failureReason: string | null,
  ): Promise<PaymentRecord | null> {
    const rows = updateReturningRows(
      await this.repo.query(
        `UPDATE payments
           SET status = '${PaymentStatus.FAILED}',
               failed_at_utc = now(),
               failure_reason = COALESCE($2, failure_reason),
               updated_at_utc = now()
         WHERE stripe_payment_intent_id = $1
           AND status NOT IN (${TERMINAL_SQL})
         RETURNING ${SELECT_COLUMNS}`,
        [stripePaymentIntentId, failureReason],
      ),
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  async markProcessingByIntentId(
    stripePaymentIntentId: string,
  ): Promise<PaymentRecord | null> {
    // Only advance from a not-yet-settled state — never regress SUCCEEDED/FAILED/etc.
    const rows = updateReturningRows(
      await this.repo.query(
        `UPDATE payments
           SET status = '${PaymentStatus.PROCESSING}',
               updated_at_utc = now()
         WHERE stripe_payment_intent_id = $1
           AND status IN ('${PaymentStatus.PENDING}', '${PaymentStatus.REQUIRES_ACTION}')
         RETURNING ${SELECT_COLUMNS}`,
        [stripePaymentIntentId],
      ),
    );
    return rows.length ? mapRow(rows[0]) : null;
  }
}
