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
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { StripeEvent, StripeService } from './stripe.service';
import { StripeConnectService } from './stripe-connect.service';

/**
 * Stripe webhook ingress. Authenticated by the Stripe signature (NOT the JWT
 * guard), so the route is @Public(). Requires the RAW request body — enabled
 * globally via `rawBody: true` in main.ts and read from `req.rawBody` here; the
 * JSON-parsed body would fail signature verification.
 */
@Controller('webhooks')
export class StripeWebhooksController {
  private readonly logger = new Logger(StripeWebhooksController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly connectService: StripeConnectService,
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

    // Inline processing (3.10a). Respond 200 once handled; the work is a cheap
    // snapshot overwrite. BullMQ offload is deferred to 3.10b.
    await this.connectService.handleWebhookEvent(event);
    return { received: true };
  }
}
