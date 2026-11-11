import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { EmailTemplateName } from './templates';

/**
 * Emails that must reach their recipient even when the day's notification
 * budget is spent: a locked-out user waiting for a reset link, and a client
 * whose payment needs a gesture. Everything else is a notification — useful,
 * never urgent.
 *
 * Typed against the template registry so a renamed template is a build error,
 * not a silently demoted email.
 */
export const ESSENTIAL_TEMPLATES: ReadonlySet<EmailTemplateName> = new Set<EmailTemplateName>([
  'password-reset',
  // Mandate L1: essential (priority 1, never counted in the notification
  // budget), but metered by its OWN daily cap — see `reserveVerification`.
  'email-verification',
  'deposit-failed-client',
  'balance-failed-client',
]);

export const isEssentialTemplate = (template: EmailTemplateName): boolean =>
  ESSENTIAL_TEMPLATES.has(template);

/**
 * BullMQ priorities: a LOWER number runs first, and a job with no priority (0)
 * outranks every prioritised one — so both classes are given an explicit value.
 */
export const ESSENTIAL_EMAIL_PRIORITY = 1;
export const NON_ESSENTIAL_EMAIL_PRIORITY = 10;

export const DEFAULT_EMAIL_DAILY_BUDGET = 200;

/** Share of the budget at which one warning is written per day. */
const WARN_AT_RATIO = 0.8;

/** Two days: the key outlives its own day so a late INCR never resurrects it. */
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

const KEY_PREFIX = 'linkr:email-budget:v1:';

export const DEFAULT_EMAIL_VERIFICATION_DAILY_BUDGET = 60;

/** Separate key: verification mails never spend the notification budget. */
const VERIFICATION_KEY_PREFIX = 'linkr:email-verification-budget:v1:';

/**
 * Brevo's daily quota resets at midnight Eastern time, so the budget's day
 * follows the same clock (named zone, never a fixed offset: it handles
 * daylight saving). A UTC day would roll over at 19:00 (winter) or 20:00
 * (summer) in Toronto and let up to two quotas' worth of mail through one
 * Brevo day.
 */
export const BUDGET_TIME_ZONE = 'America/Toronto';

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUDGET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** AAAA-MM-JJ of the instant, on the Toronto calendar. */
export const budgetDay = (instant: Date): string => {
  const parts = Object.fromEntries(
    DAY_FORMAT.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

/**
 * Daily cap on NON-essential emails, kept in Redis under a Toronto-day key.
 *
 * Why it exists: the free Brevo plan allows 300 sends a day, and a password
 * reset must not fail because notifications spent the quota. The default cap
 * of 200 leaves 100 for the essentials and for retries.
 *
 * The counter counts non-essential ATTEMPTS of the Toronto day, refused ones
 * included (a refusal is not rolled back): it measures pressure, not sends.
 * Reaching the warning threshold and reaching the cap are both decided by
 * `INCR`'s return value, which is atomic — so each fires exactly once per
 * day without a second key.
 *
 * ⚠️ FAILS OPEN. A Redis that cannot be reached returns "allowed": a budget
 * that blocks mail when its own store is down would turn a cache outage into an
 * email outage. In that case `queue.add` fails exactly as it does today (the
 * queue lives in the same Redis), so the behaviour is not made worse.
 *
 * ⚠️ NOTHING HERE LOGS AN ADDRESS OR A VARIABLE — template name and counter only.
 */
@Injectable()
export class EmailBudgetService {
  private readonly logger = new Logger(EmailBudgetService.name);
  private readonly dailyBudget: number;
  private readonly verificationDailyBudget: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    this.dailyBudget = configService.get<number>(
      'EMAIL_DAILY_BUDGET',
      DEFAULT_EMAIL_DAILY_BUDGET,
    );
    this.verificationDailyBudget = configService.get<number>(
      'EMAIL_VERIFICATION_DAILY_BUDGET',
      DEFAULT_EMAIL_VERIFICATION_DAILY_BUDGET,
    );
  }

  /**
   * Reserves one verification email in today's (Toronto day) verification
   * budget. False means "cap reached": the caller must refuse BEFORE creating
   * anything (sign-up answers 503 before the account exists; resend answers 503
   * before a token exists).
   *
   * ⚠️ A RESERVATION IS NEVER GIVEN BACK. If sign-up reserves a slot and then
   * fails (an address that raced in, a database error), that slot is lost for
   * the day. Accepted: it can only make the cap trip a little early, never let
   * more mail through than configured, and it needs no second write.
   *
   * ⚠️ FAILS OPEN, like `allow`: a Redis that cannot be reached returns true.
   * Sign-up then proceeds and the enqueue fails as every other mail does today;
   * the failure is logged and the user can ask for a resend.
   */
  async reserveVerification(): Promise<boolean> {
    let count: number;
    try {
      const key = `${VERIFICATION_KEY_PREFIX}${budgetDay(new Date())}`;
      count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, KEY_TTL_SECONDS);
      }
    } catch {
      return true;
    }

    if (count > this.verificationDailyBudget) {
      this.logger.warn(
        `Email verification budget exhausted (${count}/${this.verificationDailyBudget}) for today (Toronto day)`,
      );
      return false;
    }
    return true;
  }

  /** BullMQ priority for a template — essentials run first. */
  priorityFor(template: EmailTemplateName): number {
    return isEssentialTemplate(template)
      ? ESSENTIAL_EMAIL_PRIORITY
      : NON_ESSENTIAL_EMAIL_PRIORITY;
  }

  /**
   * True when the email may be queued. Essentials are never counted and never
   * blocked. For the rest, false means "over today's cap": the caller must
   * drop the email and carry on without an error.
   */
  async allow(template: EmailTemplateName): Promise<boolean> {
    if (isEssentialTemplate(template)) {
      return true;
    }

    let count: number;
    try {
      const key = `${KEY_PREFIX}${budgetDay(new Date())}`;
      count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, KEY_TTL_SECONDS);
      }
    } catch {
      // Redis unreachable: do not make it worse (see class doc).
      return true;
    }

    const warnAt = Math.ceil(this.dailyBudget * WARN_AT_RATIO);
    if (count === warnAt) {
      this.logger.warn(
        `Non-essential email budget at ${count}/${this.dailyBudget} for today (Toronto day); ` +
          'beyond the cap these emails are dropped',
      );
    }

    if (count > this.dailyBudget) {
      this.logger.warn(
        `Non-essential email "${template}" dropped: daily budget exhausted (${count}/${this.dailyBudget})`,
      );
      return false;
    }
    return true;
  }
}
