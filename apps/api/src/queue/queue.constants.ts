import { DefaultJobOptions } from 'bullmq';
// Type-only import from a leaf type file: no runtime coupling, no cycle.
import type { EmailVars, Locale } from '../common/email/templates/types';

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

/** The BullMQ queue carrying outbound transactional email (chantier A-1). */
export const EMAIL_QUEUE = 'email';

/**
 * Per-job retry policy for email. Deliberately NOT the stripe-webhooks policy
 * above — options are per queue, the global defaults are untouched.
 *
 *   • `removeOnComplete: true` — a delivered job is deleted outright. A-2 puts
 *     a password-reset token in `vars`, and a completed job must not leave it
 *     sitting in Redis.
 *   • `removeOnFail: { age, count }` — failures are kept, bounded: a mail that
 *     never left is exactly what somebody will need to diagnose.
 *
 * ⚠️ Those two pull in opposite directions, and the tension is ACCEPTED rather
 * than papered over. A FAILED job keeps its whole payload for up to 24 h, so
 * in A-2 a token whose delivery failed is retained for that long. The obvious
 * escape — enqueue an id and re-read the secret at send time — is CLOSED: the
 * database will store only the token's HASH, so there is nothing to re-read.
 * Therefore the ceiling on exposure in A-2 is THE TOKEN'S OWN LIFETIME, not
 * Redis eviction. Keep it short-lived and single-use; do not lengthen it on the
 * assumption that Redis forgets. It may well not: BullMQ's eviction is
 * best-effort and evaluated only when a LATER job of the same kind finishes, so
 * an isolated failed job can outlive its age cap indefinitely.
 */
export const EMAIL_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: { age: 24 * 60 * 60, count: 100 },
};

/**
 * Shape of a job enqueued by EmailService.
 *
 * The payload says WHAT TO RENDER, never the rendered mail: the worker renders.
 * Lighter payload, templates stay editable without invalidating jobs already
 * queued, and job logs do not haul a full message body around.
 *
 * `template` is a plain `string` here on purpose — this is the wire shape, and
 * a value that has round-tripped through Redis JSON carries no union with it.
 * The compile-time guarantee lives at the producer (`EmailService.send`) and is
 * re-established in the worker via `isEmailTemplateName`.
 */
export interface EmailJob {
  to: string;
  template: string;
  vars: EmailVars;
  locale: Locale;
}
