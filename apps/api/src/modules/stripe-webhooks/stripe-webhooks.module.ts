import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { StripeConnectModule } from '../stripe-connect/stripe-connect.module';
import { PaymentsModule } from '../payments/payments.module';
import { ServiceRequestsModule } from '../service-requests/service-requests.module';
import { StripeWebhooksController } from './stripe-webhooks.controller';
import { StripeWebhookProcessor } from './stripe-webhook.processor';

/**
 * Webhook ingress (producer) + async processor (consumer) for Stripe events.
 * Lives apart from the domain modules so the processor can depend on ALL of
 * StripeConnectService + PaymentsService/RefundsService + ServiceRequestsService
 * without forming a module cycle — every one of those imports is
 * one-directional (nothing imports StripeWebhooksModule).
 */
@Module({
  imports: [
    QueueModule,
    StripeConnectModule,
    PaymentsModule,
    ServiceRequestsModule,
  ],
  controllers: [StripeWebhooksController],
  providers: [StripeWebhookProcessor],
})
export class StripeWebhooksModule {}
