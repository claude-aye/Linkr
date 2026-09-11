import { EmailTemplateName } from '../../../common/email/templates';
import { NotificationType } from '../enums/notification-type.enum';

/**
 * Which channels each domain event speaks on.
 *
 * Why this file exists
 * --------------------
 * The send calls themselves are deliberately scattered: each service owns the
 * variables its own event carries, and only it can supply them. What must NOT
 * scatter is the DECISION — "this event emails, that one does not, and here is
 * why". Without one place holding it, "we chose silence" and "we forgot" become
 * indistinguishable the first time someone reads the code three weeks later.
 *
 * The `Record<DomainEvent, EventChannels>` below is the whole mechanism: adding
 * a member to `DomainEvent` without giving it an entry is a COMPILE error, not
 * a failing test and not a lint warning. Same principle as `EMAIL_TEMPLATES`
 * (`as const` makes an unknown template name uncompilable) and as `Locale`
 * (a missing translation breaks the build rather than falling back silently).
 *
 * What it does NOT do
 * -------------------
 * It catches "nobody decided". It does not catch "nobody called" — a service
 * can ignore this registry entirely. Closing that would need a domain event
 * emitter, which buys a new asynchronous failure mode and a hard question about
 * transaction boundaries: emitting before commit recreates precisely the defect
 * #96 fixed on the capture path. Deliberately not built.
 */

/** Decided, undecided, and deliberately-not — three states, never two. */
export type ChannelDecision<TTarget> =
  | { readonly kind: 'send'; readonly target: TTarget }
  | { readonly kind: 'skip'; readonly why: string }
  | { readonly kind: 'todo'; readonly why: string };

/** This event speaks on this channel, through this target. */
export const send = <TTarget>(target: TTarget): ChannelDecision<TTarget> => ({
  kind: 'send',
  target,
});

/**
 * This event will never speak on this channel, and here is why. A reason is
 * mandatory: an unexplained silence is indistinguishable from an oversight.
 */
export const skip = (why: string): ChannelDecision<never> => ({
  kind: 'skip',
  why,
});

/**
 * This event SHOULD speak on this channel, but the target does not exist yet.
 * Distinct from `skip` on purpose — collapsing the two would turn the backlog
 * into a set of decisions nobody remembers making.
 */
export const todo = (why: string): ChannelDecision<never> => ({
  kind: 'todo',
  why,
});

/**
 * Every event worth telling somebody about.
 *
 * Only the first two emit anything today. The rest are real domain transitions
 * that currently notify NOBODY, on either channel — which is the actual size of
 * chantier A, and the reason this union is longer than the code that uses it.
 */
export type DomainEvent =
  | 'tender.matched'
  | 'booking.direct.created'
  | 'request.accepted'
  | 'request.declined'
  | 'deposit.failed'
  | 'job.completed'
  | 'quote.sent';

export interface EventChannels {
  readonly inApp: ChannelDecision<NotificationType>;
  readonly email: ChannelDecision<EmailTemplateName>;
}

/**
 * ⚠️ In-app is FROZEN for now. `notifications.type` is a PostgreSQL enum
 * (`notification_type`), so every new value costs a migration — and on this
 * server (16.4) a value added inside a transaction cannot be USED until that
 * transaction commits. Email costs no schema change at all, which is why the
 * first slice of chantier A is email-only and the in-app entries below read
 * `todo` rather than `send`.
 *
 * ⚠️ `booking.direct.created` EMAILS INDIVIDUAL PROVIDERS ONLY. A provider can
 * be an ORGANIZATION, and then `service_providers.user_id` is null (CHECK
 * constraint): there is no single human to write to. The in-app notification
 * does not have this problem — it is addressed to the provider id and the
 * dashboard resolves the rest. Booking an organization therefore sends NO
 * email today; the path logs a warning and returns.
 *
 * Reopening it is a product decision, not a lookup: `organization_memberships`
 * models `OWNER` and `WORKER`, so the arbitration is between every active
 * OWNER and a single operations address — who receives, who answers, who is
 * accountable for the job. Not improvised here.
 */
export const EVENT_CHANNELS: Record<DomainEvent, EventChannels> = {
  'tender.matched': {
    inApp: send(NotificationType.NEW_TENDER_MATCH),
    email: skip(
      'volume — a provider matches dozens of tenders; emailing each one is how you get unsubscribed before the events that matter arrive',
    ),
  },

  'booking.direct.created': {
    inApp: send(NotificationType.NEW_DIRECT_BOOKING),
    email: send('direct-booking'),
  },

  'request.accepted': {
    inApp: todo('no notification_type yet — grouped migration once the set is settled'),
    // Sent on a 202 too. The assignment is committed and the job IS the
    // provider's whether or not the capture settled — T4, behind #96. The
    // template says nothing about the deposit: the client cannot retry it
    // anyway (see the product debt in CLAUDE.md).
    email: send('request-accepted'),
  },

  'request.declined': {
    inApp: todo('no notification_type yet — grouped migration once the set is settled'),
    email: todo('the client learns to look elsewhere; silence here reads as abandonment'),
  },

  'deposit.failed': {
    inApp: todo('no notification_type yet — grouped migration once the set is settled'),
    email: todo(
      'the explicit-state decision from #96 is invisible without this: the job holds, the deposit is FAILED, and retry-deposit is the way out',
    ),
  },

  'job.completed': {
    inApp: todo('no notification_type yet — grouped migration once the set is settled'),
    email: todo('the client confirms, and the 72h auto-release clock starts'),
  },

  'quote.sent': {
    inApp: todo('no notification_type yet — grouped migration once the set is settled'),
    email: todo('a quote nobody is told about is a quote that expires'),
  },
};

/** The email template for an event, or null when it stays silent. */
export function emailTemplateFor(event: DomainEvent): EmailTemplateName | null {
  const decision = EVENT_CHANNELS[event].email;
  return decision.kind === 'send' ? decision.target : null;
}

/** The in-app notification type for an event, or null when it stays silent. */
export function notificationTypeFor(event: DomainEvent): NotificationType | null {
  const decision = EVENT_CHANNELS[event].inApp;
  return decision.kind === 'send' ? decision.target : null;
}

/**
 * Everything still owed, per channel. This registry is the live backlog of
 * chantier A — a `todo` here is work, a `skip` is a closed question.
 */
export function pendingChannels(): Array<{
  event: DomainEvent;
  channel: 'inApp' | 'email';
  why: string;
}> {
  const pending: Array<{
    event: DomainEvent;
    channel: 'inApp' | 'email';
    why: string;
  }> = [];

  for (const [event, channels] of Object.entries(EVENT_CHANNELS) as Array<
    [DomainEvent, EventChannels]
  >) {
    if (channels.inApp.kind === 'todo') {
      pending.push({ event, channel: 'inApp', why: channels.inApp.why });
    }
    if (channels.email.kind === 'todo') {
      pending.push({ event, channel: 'email', why: channels.email.why });
    }
  }

  return pending;
}
