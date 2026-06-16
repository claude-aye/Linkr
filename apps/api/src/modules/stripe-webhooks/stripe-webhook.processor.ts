import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  StripeAccount,
  StripePaymentIntent,
} from '../stripe-connect/stripe.service';
import { StripeConnectService } from '../stripe-connect/stripe-connect.service';
import { PaymentsService } from '../payments/payments.service';
import { RefundsService } from '../payments/refunds.service';
import { PaymentType } from '../payments/enums/payment-type.enum';
import { PaymentStatus } from '../payments/enums/payment-status.enum';
import { ServiceRequestsService } from '../service-requests/service-requests.service';
import {
  STRIPE_WEBHOOKS_QUEUE,
  StripeWebhookJob,
} from '../../queue/queue.constants';

/** Minimal shape of a Stripe Refund as read off refund/charge events. */
interface StripeRefundShape {
  id: string;
  status: string | null;
  failure_reason?: string | null;
}
/** Minimal shape of a Stripe Charge as read off `charge.refunded`. */
interface StripeChargeShape {
  id: string;
  refunds?: { data?: StripeRefundShape[] } | null;
}

/**
 * Consumes verified Stripe webhook events off the "stripe-webhooks" queue and
 * applies them. A thrown error fails the job and BullMQ retries it (5 attempts,
 * exponential backoff) — Stripe already got its 200, so retries are local.
 *
 * Idempotency is structural (no event-id store yet — see TODO):
 *   • account.updated         → snapshot overwrite of the local Connect mirror;
 *   • payment_intent.*         → forward-only conditional status UPDATEs that
 *                                never regress a terminal status; a SUCCEEDED
 *                                BALANCE additionally drives request → PAID;
 *   • charge.refunded /        → advance the refund row, recompute the payment
 *     refund.updated             status, and drive request → REFUNDED when every
 *                                captured payment is fully refunded.
 */
@Processor(STRIPE_WEBHOOKS_QUEUE)
export class StripeWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(StripeWebhookProcessor.name);

  constructor(
    private readonly connectService: StripeConnectService,
    private readonly paymentsService: PaymentsService,
    private readonly refundsService: RefundsService,
    private readonly serviceRequestsService: ServiceRequestsService,
  ) {
    super();
  }

  async process(job: Job<StripeWebhookJob>): Promise<void> {
    const { eventId, type, data } = job.data;

    // TODO (3.10b+): persist processed event ids (Redis/DB) for exactly-once
    // semantics across deliveries. Until then idempotency is structural (above).
    switch (type) {
      case 'account.updated': {
        const account = data as unknown as StripeAccount;
        const updated = await this.connectService.syncFromAccount(account);
        if (updated) {
          this.logger.log(
            `account.updated ${account.id} → ${updated.onboardingStatus} ` +
              `(charges=${updated.chargesEnabled}, payouts=${updated.payoutsEnabled})`,
          );
        } else {
          this.logger.log(
            `account.updated ${account.id} → ignored (not a Linkr-managed account)`,
          );
        }
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = data as unknown as StripePaymentIntent;
        const payment = await this.paymentsService.markSucceeded(pi.id);
        // Only the BALANCE drives the request to PAID (deposit success is silent).
        if (
          payment &&
          payment.paymentType === PaymentType.BALANCE &&
          payment.status === PaymentStatus.SUCCEEDED
        ) {
          await this.serviceRequestsService.markRequestPaid(payment.serviceRequestId);
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = data as unknown as StripePaymentIntent;
        await this.paymentsService.markFailed(
          pi.id,
          pi.last_payment_error?.message ?? null,
        );
        break;
      }
      case 'payment_intent.processing': {
        const pi = data as unknown as StripePaymentIntent;
        await this.paymentsService.markProcessing(pi.id);
        break;
      }
      case 'charge.refunded': {
        const charge = data as unknown as StripeChargeShape;
        for (const refund of charge.refunds?.data ?? []) {
          await this.handleRefundSync(refund);
        }
        break;
      }
      case 'refund.updated': {
        const refund = data as unknown as StripeRefundShape;
        await this.handleRefundSync(refund);
        break;
      }
      default:
        // Unknown/unhandled types are acked (no-op) so they don't pile up.
        this.logger.log(`Ignoring unhandled Stripe event ${eventId} (${type})`);
    }
  }

  /**
   * Settle one refund: advance our refund row + recompute the payment status,
   * then transition the request → REFUNDED when every captured payment is now
   * fully refunded. The request transition lives here (not in PaymentsService)
   * so PaymentsModule stays independent of the service-requests domain.
   */
  private async handleRefundSync(refund: StripeRefundShape): Promise<void> {
    const result = await this.refundsService.syncFromStripe(
      refund.id,
      refund.status,
      refund.failure_reason ?? null,
    );
    if (result?.requestFullyRefunded) {
      await this.serviceRequestsService.markRequestRefunded(result.serviceRequestId);
    }
  }
}
