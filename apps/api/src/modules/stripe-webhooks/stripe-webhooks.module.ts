import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { StripeConnectModule } from '../stripe-connect/stripe-connect.module';
import { PaymentsModule } from '../payments/payments.module';
import { StripeWebhooksController } from './stripe-webhooks.controller';
import { StripeWebhookProcessor } from './stripe-webhook.processor';

/**
 * Webhook ingress (producer) + async processor (consumer) for Stripe events.
 * Lives apart from StripeConnectModule/PaymentsModule so the processor can
 * depend on BOTH (StripeConnectService + PaymentsService) without forming a
 * module cycle (PaymentsModule → StripeConnectModule is one-directional).
 */
@Module({
  imports: [QueueModule, StripeConnectModule, PaymentsModule],
  controllers: [StripeWebhooksController],
  providers: [StripeWebhookProcessor],
})
export class StripeWebhooksModule {}
