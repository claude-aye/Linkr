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
    // Type derived from the client value (the SDK's `Stripe.*` namespace is not
    // resolution-stable — see stripe.service.ts).
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
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await this.refundRepo.markFailed(refund.id, detail);
      this.logger.error(`Refund ${refund.id} failed at Stripe: ${detail}`);
      throw new RefundChargeFailedException(detail);
    }

    // 3) Persist the Stripe id + returned status.
    const status = mapRefundStatus(stripeRefund.status);
    await this.refundRepo.attachStripe(refund.id, stripeRefund.id, status);
    this.logger.log(
      `Refund ${refund.id} (${amount} ${currency}) on payment ${paymentId}: ` +
        `${stripeRefund.id} → ${status}`,
    );

    // 4) Recompute the payment status (final settlement via webhook).
    await this.recomputePaymentRefundStatus(paymentId);

    const updated = await this.refundRepo.findById(refund.id);
    return this.toResponseDto(updated ?? refund);
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
