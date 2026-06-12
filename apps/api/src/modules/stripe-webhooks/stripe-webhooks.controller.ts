import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { StripeEvent, StripeService } from '../stripe-connect/stripe.service';
import {
  STRIPE_WEBHOOKS_QUEUE,
  StripeWebhookJob,
} from '../../queue/queue.constants';

/**
 * Stripe webhook ingress. Authenticated by the Stripe signature (NOT the JWT
 * guard), so the route is @Public(). Requires the RAW request body — enabled
 * globally via `rawBody: true` in main.ts and read from `req.rawBody` here.
 *
 * Per CLAUDE.md §9 rule 7 the handler does NO business processing: it verifies
 * the signature, enqueues the event to BullMQ, and returns 200 immediately so
 * Stripe gets a fast ack. The worker (StripeWebhookProcessor) does the work.
 */
@Controller('webhooks')
export class StripeWebhooksController {
  private readonly logger = new Logger(StripeWebhooksController.name);

  constructor(
    private readonly stripe: StripeService,
    @InjectQueue(STRIPE_WEBHOOKS_QUEUE)
    private readonly queue: Queue<StripeWebhookJob>,
  ) {}

  @Public()
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleStripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody;
    if (!rawBody) {
      // Raw body missing means main.ts rawBody config regressed — fail loudly.
      throw new BadRequestException('Missing raw request body');
    }

    let event: StripeEvent;
    try {
      event = this.stripe.constructWebhookEvent(rawBody, signature);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Stripe webhook signature verification failed: ${detail}`);
      throw new BadRequestException('Invalid Stripe signature');
    }

    await this.queue.add(event.type, {
      eventId: event.id,
      type: event.type,
      data: event.data.object as unknown as Record<string, unknown>,
    });
    this.logger.log(`Enqueued Stripe webhook ${event.id} (${event.type})`);
    return { received: true };
  }
}
