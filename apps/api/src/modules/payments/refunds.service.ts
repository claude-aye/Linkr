import { Injectable, Logger } from '@nestjs/common';
import { StripeClient, StripeService } from '../stripe-connect/stripe.service';
import { fromMinorUnits, toMinorUnits } from '../../common/money/money';
import { PaymentRepository } from './repositories/payment.repository';
import { RefundRecord, RefundRepository } from './repositories/refund.repository';
import { PaymentStatus } from './enums/payment-status.enum';
import { RefundStatus } from './enums/refund-status.enum';
import { CreateRefundDto } from './dto/create-refund.dto';
import { RefundResponseDto } from './dto/refund-response.dto';
import {
  PaymentNotFoundException,
  RefundChargeFailedException,
  RefundExceedsRefundableException,
  RefundNotAllowedException,
} from './exceptions/payments.exceptions';

/** Captured payment statuses — those that actually moved money and can refund. */
const CAPTURED_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.SUCCEEDED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

/** Map a Stripe refund status to our local enum. */
function mapRefundStatus(stripeStatus: string | null): RefundStatus {
  switch (stripeStatus) {
    case 'succeeded':
      return RefundStatus.SUCCEEDED;
    case 'failed':
      return RefundStatus.FAILED;
    case 'canceled':
      return RefundStatus.CANCELLED;
    default:
      // 'pending' / 'requires_action' / null — not settled yet.
      return RefundStatus.PENDING;
  }
}

/**
 * The charge backing the PaymentIntent is already (fully) refunded — Stripe
 * rejects the duplicate create. Surfaces as a `StripeInvalidRequestError` with
 * code `charge_already_refunded`; we also match the message defensively.
 */
function isAlreadyRefundedError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'charge_already_refunded') return true;
  const msg = (e?.message ?? '').toLowerCase();
  return msg.includes('already been refunded') || msg.includes('already refunded');
}

/**
 * A DEFINITIVE Stripe error — the refund was rejected and certainly did NOT
 * process (bad params / card error), so the row may safely be marked FAILED.
 * Everything else (connection, timeout, API 5xx, rate-limit, unknown) is treated
 * as IN-DOUBT: the refund may have gone through, so the row is left PENDING.
 */
function isDefinitiveRefundError(err: unknown): boolean {
  const type = (err as { type?: string })?.type;
  return type === 'StripeInvalidRequestError' || type === 'StripeCardError';
}

/**
 * Admin-initiated refunds (3.10c). Owns the over-refund guard, the Stripe
 * refund (pro-rata `reverse_transfer` + `refund_application_fee`), and the
 * forward-only payment-status derivation. The request → REFUNDED transition is
 * driven by the webhook worker (PaymentsModule never depends on the
 * service-requests domain), which calls {@link syncFromStripe} and acts on the
 * returned `requestFullyRefunded` flag.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly refundRepo: RefundRepository,
    private readonly paymentRepo: PaymentRepository,
  ) {}

  async refundPayment(
    paymentId: string,
    dto: CreateRefundDto,
    adminUserId: string,
  ): Promise<RefundResponseDto> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) throw new PaymentNotFoundException();

    if (!payment.stripePaymentIntentId) {
      throw new RefundNotAllowedException('the payment was never captured');
    }
    if (!CAPTURED_STATUSES.includes(payment.status)) {
      throw new RefundNotAllowedException(
        `the payment is ${payment.status} (only captured payments can be refunded)`,
      );
    }

    const currency = payment.currency.toUpperCase();

    // Anti-over-refund: requested <= gross − Σ(PENDING + SUCCEEDED refunds).
    const inFlight = await this.refundRepo.sumInFlightByPaymentId(paymentId);
    const grossMinor = toMinorUnits(payment.grossAmount, currency);
    const inFlightMinor = toMinorUnits(inFlight, currency);
    const requestedMinor = toMinorUnits(String(dto.amount), currency);
    const refundableMinor = grossMinor - inFlightMinor;
    if (requestedMinor > refundableMinor) {
      throw new RefundExceedsRefundableException(
        fromMinorUnits(Math.max(refundableMinor, 0), currency),
        currency,
      );
    }
    const amount = fromMinorUnits(requestedMinor, currency);

    // 1) Insert the refund row (PENDING) — its id is the Stripe idempotency key.
    const refund = await this.refundRepo.create({
      paymentId,
      amount,
      currency,
      reason: dto.reason,
      initiatedByUserId: adminUserId,
    });

    // 2) Stripe refund — pro-rata fee reversal applied automatically on partials.
    // `idempotencyKey = ref_<refund.id>` makes a retry that reuses this row safe
    // (Stripe replays the same refund instead of erroring). Type derived from the
    // client value (the SDK's `Stripe.*` namespace is not resolution-stable —
    // see stripe.service.ts).
    let stripeRefund: Awaited<ReturnType<StripeClient['refunds']['create']>>;
    try {
      stripeRefund = await this.stripe.client.refunds.create(
        {
          payment_intent: payment.stripePaymentIntentId,
          amount: requestedMinor,
          reverse_transfer: true,
          refund_application_fee: true,
          metadata: { refund_id: refund.id, payment_id: paymentId },
        },
        { idempotencyKey: `ref_${refund.id}` },
      );
      // 4) Persist the Stripe refund id IMMEDIATELY (before any further work) so a
      // later failure can never leave a processed refund with a null id in the DB.
      await this.refundRepo.attachStripe(
        refund.id,
        stripeRefund.id,
        mapRefundStatus(stripeRefund.status),
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);

      // 3) Already-refunded recovery: the charge was refunded — often by a prior
      // attempt whose ack we lost. Reconcile our PENDING row to the real Stripe
      // refund instead of marking it FAILED (which would hide the real refund).
      if (isAlreadyRefundedError(err)) {
        const reconciled = await this.reconcileAlreadyRefunded(
          refund.id,
          payment.stripePaymentIntentId,
          paymentId,
          requestedMinor,
        );
        if (reconciled) return reconciled;
      }

      // Definitive card/request error → the refund certainly did not process.
      if (isDefinitiveRefundError(err)) {
        await this.refundRepo.markFailed(refund.id, detail);
        this.logger.error(`Refund ${refund.id} rejected by Stripe: ${detail}`);
        throw new RefundChargeFailedException(detail);
      }

      // Connection/timeout/in-doubt → the refund MAY have gone through. Leave the
      // row PENDING (a retry or the webhook reconciles it) and surface 502.
      this.logger.warn(
        `Refund ${refund.id} in-doubt after a transient Stripe error; left PENDING: ${detail}`,
      );
      throw new RefundChargeFailedException(detail);
    }

    const status = mapRefundStatus(stripeRefund.status);
    this.logger.log(
      `Refund ${refund.id} (${amount} ${currency}) on payment ${paymentId}: ` +
        `${stripeRefund.id} → ${status}`,
    );

    // Recompute the payment status (final settlement via webhook).
    await this.recomputePaymentRefundStatus(paymentId);

    const updated = await this.refundRepo.findById(refund.id);
    return this.toResponseDto(updated ?? refund);
  }

  /**
   * Recover from a `charge_already_refunded` rejection: list the PaymentIntent's
   * refunds at Stripe and link the matching one (prefer the exact amount; skip
   * any already mapped to a different local row) to our PENDING row — instead of
   * losing the real refund behind a FAILED row. Idempotent. Returns the
   * reconciled response, or null if no unlinked Stripe refund was found.
   */
  private async reconcileAlreadyRefunded(
    refundId: string,
    paymentIntentId: string,
    paymentId: string,
    expectedAmountMinor: number,
  ): Promise<RefundResponseDto | null> {
    let list: Awaited<ReturnType<StripeClient['refunds']['list']>>;
    try {
      list = await this.stripe.client.refunds.list({
        payment_intent: paymentIntentId,
        limit: 100,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Refund ${refundId} reconcile: failed to list Stripe refunds: ${detail}`,
      );
      return null;
    }

    // Candidates: Stripe refunds not already mapped to a DIFFERENT local row.
    const candidates: Array<{ id: string; status: string | null; amount: number }> = [];
    for (const sr of list.data) {
      const existing = await this.refundRepo.findByStripeRefundId(sr.id);
      if (existing && existing.id !== refundId) continue;
      candidates.push({ id: sr.id, status: sr.status, amount: sr.amount });
    }
    // Prefer the exact amount; else the most recent (Stripe lists newest-first).
    const match =
      candidates.find((c) => c.amount === expectedAmountMinor) ?? candidates[0];
    if (!match) {
      this.logger.error(
        `Refund ${refundId}: charge already refunded but no unlinked Stripe refund found for ${paymentIntentId}`,
      );
      return null;
    }

    const status = mapRefundStatus(match.status);
    await this.refundRepo.attachStripe(refundId, match.id, status);
    await this.recomputePaymentRefundStatus(paymentId);
    this.logger.log(
      `Refund ${refundId} reconciled to existing Stripe refund ${match.id} → ${status}`,
    );
    const updated = await this.refundRepo.findById(refundId);
    return updated ? this.toResponseDto(updated) : null;
  }

  /**
   * Webhook-driven settlement (charge.refunded / refund.updated): advance the
   * refund row, recompute the parent payment status, and report whether EVERY
   * captured payment of the request is now fully REFUNDED (so the worker can
   * transition the request → REFUNDED). Returns null if the refund is unknown.
   */
  async syncFromStripe(
    stripeRefundId: string,
    stripeStatus: string | null,
    failureReason: string | null,
  ): Promise<{ serviceRequestId: string; requestFullyRefunded: boolean } | null> {
    const status = mapRefundStatus(stripeStatus);
    const refund = await this.refundRepo.advanceStatusByStripeId(
      stripeRefundId,
      status,
      failureReason,
    );
    if (!refund) {
      this.logger.log(
        `Refund webhook for unknown stripe refund ${stripeRefundId} → no-op`,
      );
      return null;
    }

    await this.recomputePaymentRefundStatus(refund.paymentId);

    const payment = await this.paymentRepo.findById(refund.paymentId);
    if (!payment) return null;

    const requestFullyRefunded = await this.isRequestFullyRefunded(
      payment.serviceRequestId,
    );
    return { serviceRequestId: payment.serviceRequestId, requestFullyRefunded };
  }

  /**
   * Forward-only payment status from the settled (SUCCEEDED) refund total:
   * Σ == gross → REFUNDED ; 0 < Σ < gross → PARTIALLY_REFUNDED ; Σ == 0 → no-op.
   */
  private async recomputePaymentRefundStatus(paymentId: string): Promise<void> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) return;

    const sumSucceeded = await this.refundRepo.sumSucceededByPaymentId(paymentId);
    const currency = payment.currency.toUpperCase();
    const refundedMinor = toMinorUnits(sumSucceeded, currency);
    if (refundedMinor <= 0) return;

    const grossMinor = toMinorUnits(payment.grossAmount, currency);
    const target =
      refundedMinor >= grossMinor
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;
    await this.paymentRepo.applyRefundDerivedStatus(paymentId, target);
  }

  /** True when ≥1 captured payment exists for the request and all are REFUNDED. */
  private async isRequestFullyRefunded(serviceRequestId: string): Promise<boolean> {
    const payments = await this.paymentRepo.findByServiceRequestId(serviceRequestId);
    const captured = payments.filter((p) => CAPTURED_STATUSES.includes(p.status));
    return (
      captured.length > 0 &&
      captured.every((p) => p.status === PaymentStatus.REFUNDED)
    );
  }

  private toResponseDto(record: RefundRecord): RefundResponseDto {
    const dto = new RefundResponseDto();
    dto.id = record.id;
    dto.paymentId = record.paymentId;
    dto.amount = record.amount;
    dto.currency = record.currency;
    dto.reason = record.reason;
    dto.initiatedByUserId = record.initiatedByUserId;
    dto.status = record.status;
    dto.stripeRefundId = record.stripeRefundId;
    dto.failureReason = record.failureReason;
    dto.createdAtUtc = record.createdAtUtc;
    dto.updatedAtUtc = record.updatedAtUtc;
    return dto;
  }
}
