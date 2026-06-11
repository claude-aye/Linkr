import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  StripeAccount,
  StripePaymentIntent,
} from '../stripe-connect/stripe.service';
import { StripeConnectService } from '../stripe-connect/stripe-connect.service';
import { PaymentsService } from '../payments/payments.service';
import {
  STRIPE_WEBHOOKS_QUEUE,
  StripeWebhookJob,
} from '../../queue/queue.constants';

/**
 * Consumes verified Stripe webhook events off the "stripe-webhooks" queue and
 * applies them. A thrown error fails the job and BullMQ retries it (5 attempts,
 * exponential backoff) — Stripe already got its 200, so retries are local.
 *
 * Idempotency is structural (no event-id store yet — see TODO):
 *   • account.updated         → snapshot overwrite of the local Connect mirror;
 *   • payment_intent.*         → forward-only conditional status UPDATEs that
 *                                never regress a terminal status.
 */
@Processor(STRIPE_WEBHOOKS_QUEUE)
export class StripeWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(StripeWebhookProcessor.name);

  constructor(
    private readonly connectService: StripeConnectService,
    private readonly paymentsService: PaymentsService,
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
        await this.paymentsService.markSucceeded(pi.id);
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
      default:
        // Unknown/unhandled types are acked (no-op) so they don't pile up.
        this.logger.log(`Ignoring unhandled Stripe event ${eventId} (${type})`);
    }
  }
}
