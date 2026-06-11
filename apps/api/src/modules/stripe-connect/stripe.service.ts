import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Stripe SDK type aliases derived from the client value itself.
 *
 * Stripe v22 ships two type entry points whose `Stripe.*` namespaces differ
 * (the CJS entry exposes `Stripe.Stripe`, the ESM entry exposes `Stripe.Account`
 * / `Stripe.Event`), and tsc vs ts-node resolve to different ones. To stay
 * resolution-agnostic we derive every type from the `Stripe` *value* — never
 * from a namespace member — so the code type-checks identically under both.
 */
export type StripeClient = InstanceType<typeof Stripe>;
/** The verified webhook event — a discriminated union keyed by `type`. */
export type StripeEvent = ReturnType<StripeClient['webhooks']['constructEvent']>;
/** The bare Account resource (extracted from the `account.updated` event). */
export type StripeAccount = Extract<
  StripeEvent,
  { type: 'account.updated' }
>['data']['object'];
/** The bare PaymentIntent resource (extracted from a `payment_intent.*` event). */
export type StripePaymentIntent = Extract<
  StripeEvent,
  { type: 'payment_intent.succeeded' }
>['data']['object'];

/**
 * Single owner of the Stripe SDK client. Instantiated with the secret key from
 * the (boot-validated) env; the SDK's own pinned `apiVersion` is used — we do
 * not override it. Inject this anywhere the raw Stripe API is needed.
 */
@Injectable()
export class StripeService {
  readonly client: StripeClient;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.client = new Stripe(secretKey);
    this.webhookSecret = this.config.getOrThrow<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
  }

  /**
   * Verify a webhook signature against the raw request body and construct the
   * typed event. Throws `Stripe.errors.StripeSignatureVerificationError` on a
   * bad/missing signature — callers map that to a 400.
   */
  constructWebhookEvent(rawBody: Buffer, signature: string): StripeEvent {
    return this.client.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }
}
