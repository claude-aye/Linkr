import { DefaultJobOptions } from 'bullmq';

/** The BullMQ queue carrying verified Stripe webhook events for async processing. */
export const STRIPE_WEBHOOKS_QUEUE = 'stripe-webhooks';

/**
 * Per-job retry policy. Stripe has already received its 200, so retries here are
 * worker-side only: 5 attempts with exponential backoff. Completed/failed jobs
 * are trimmed so the queue does not grow unbounded.
 */
export const STRIPE_WEBHOOKS_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Shape of a job enqueued by the webhook controller. */
export interface StripeWebhookJob {
  /** Stripe event id (evt_...), for logging / future event-id dedupe. */
  eventId: string;
  /** Stripe event type, e.g. 'account.updated' / 'payment_intent.succeeded'. */
  type: string;
  /** The event's `data.object` (a Stripe resource), serialized as plain JSON. */
  data: Record<string, unknown>;
}
