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

/**
 * Mandate A (option B, 2026-11-13). Sign-up sends nothing any more: every
 * verification mail is asked for by a click. ONE global cap covers them all,
 * and inside it resends (any send that is not the account's first of the
 * Toronto day) may take at most EMAIL_VERIFICATION_RESEND_DAILY_BUDGET. So at
 * least (60 - 20) first sends always remain for accounts that have not had one
 * today, whatever a script does with resends.
 *   200 (non-essential) + 60 (verification) = 260, leaving 40 of Brevo's 300.
 */
export const DEFAULT_EMAIL_VERIFICATION_DAILY_BUDGET = 60;
export const DEFAULT_EMAIL_VERIFICATION_RESEND_DAILY_BUDGET = 20;

/** Brevo free plan: 300 sends per (Eastern) day. */
export const BREVO_DAILY_QUOTA = 300;
/** Sends left for the uncapped essentials (reset, payment failures) and retries. */
export const BREVO_ESSENTIAL_MARGIN = 40;

/**
 * Early alert: more than this many verification sends before noon (Toronto)
 * means the day's cap will likely be reached, most often by a script. One
 * WARN, at the first send past the threshold, only if it happens before noon.
 */
export const VERIFICATION_EARLY_ALERT_THRESHOLD = 30;
export const VERIFICATION_EARLY_ALERT_HOUR = 12;

/**
 * Keys (v2: the counters changed meaning with mandate A, so today's v1 counts
 * are not mixed in). The total counts every verification send; the resend key
 * counts the non-first ones; the first-send marker holds a user id (never an
 * address) for the Toronto day. To reopen a cap reached by mistake:
 * `DEL linkr:email-verification-budget:v2:<AAAA-MM-JJ>` and, if needed, the
 * resend key of the same day (docs/deploy/arret-urgence.md), never FLUSHDB.
 */
export const VERIFICATION_KEY_PREFIX = 'linkr:email-verification-budget:v2:';
export const VERIFICATION_RESEND_KEY_PREFIX =
  'linkr:email-verification-resend-budget:v2:';
export const VERIFICATION_FIRST_SEND_KEY_PREFIX =
  'linkr:email-verification-first-send:v1:';

/**
 * Brevo's daily quota resets at midnight Eastern time, so the budget's day
 * follows the same clock (named zone, never a fixed offset: it handles
 * daylight saving). A UTC day would roll over at 19:00 (winter) or 20:00
 * (summer) in Toronto and let up to two quotas' worth of mail through one
 * Brevo day.
 */
export const BUDGET_TIME_ZONE = 'America/Toronto';

const HOUR_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUDGET_TIME_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
});

/** Hour 0-23 of the instant, on the Toronto clock. */
export const budgetHour = (instant: Date): number =>
  Number(HOUR_FORMAT.formatToParts(instant).find((p) => p.type === 'hour')?.value);

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
  private readonly resendDailyBudget: number;

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
    this.resendDailyBudget = configService.get<number>(
      'EMAIL_VERIFICATION_RESEND_DAILY_BUDGET',
      DEFAULT_EMAIL_VERIFICATION_RESEND_DAILY_BUDGET,
    );
    this.warnIfBrevoMarginTooSmall();
  }

  /**
   * Boot-time WARNING (never a failure): the three caps together must leave
   * BREVO_ESSENTIAL_MARGIN sends for the uncapped essentials. A configuration
   * that does not is legal — a paid Brevo plan raises the quota — but should be
   * seen.
   */
  private warnIfBrevoMarginTooSmall(): void {
    // The resend cap lives INSIDE the verification cap, so it is not added.
    const capped = this.dailyBudget + this.verificationDailyBudget;
    const margin = BREVO_DAILY_QUOTA - capped;
    if (margin < BREVO_ESSENTIAL_MARGIN) {
      this.logger.warn(
        `Email caps leave ${margin} of ${BREVO_DAILY_QUOTA} daily Brevo sends for the uncapped essentials ` +
          `(EMAIL_DAILY_BUDGET ${this.dailyBudget} + EMAIL_VERIFICATION_DAILY_BUDGET ${this.verificationDailyBudget}); ` +
          `at least ${BREVO_ESSENTIAL_MARGIN} is recommended on the free plan`,
      );
    }
  }

  /**
   * Reserves one verification email for `userId` in today's (Toronto day)
   * budget. False means "cap reached": the caller answers 503 BEFORE a token
   * exists.
   *
   * 1. First send of the day for this account (SET NX on a per-user marker)?
   *    It only spends the global cap.
   * 2. Otherwise it is a resend: it spends the resend sub-cap first, then the
   *    global cap. Resends can never take more than the sub-cap, so the rest of
   *    the global cap stays for first sends.
   * A refused FIRST send gives its marker back, so the next try is still a
   * first send. Counters are never given back (attempts, like `allow`).
   *
   * One WARN per day at 80 % of the global cap, and one ALERT if the global
   * count passes VERIFICATION_EARLY_ALERT_THRESHOLD before noon (Toronto).
   * Both are decided by INCR's atomic return value, so each fires at most once.
   * Logs carry counters only: never an address, never a user id.
   *
   * FAILS OPEN, like `allow`: a Redis that cannot be reached returns true; the
   * enqueue then fails the same way every mail does, and the caller says so.
   */
  async reserveVerification(userId: string): Promise<boolean> {
    const day = budgetDay(new Date());
    const firstKey = `${VERIFICATION_FIRST_SEND_KEY_PREFIX}${day}:${userId}`;

    let isFirst: boolean;
    let count: number;
    try {
      isFirst = (await this.redis.set(firstKey, '1', 'EX', KEY_TTL_SECONDS, 'NX')) === 'OK';

      if (!isFirst) {
        const resends = await this.incrWithTtl(`${VERIFICATION_RESEND_KEY_PREFIX}${day}`);
        if (resends > this.resendDailyBudget) {
          if (resends === this.resendDailyBudget + 1) {
            this.logger.warn(
              `Email verification resend budget exhausted (${resends}/${this.resendDailyBudget}) for today (Toronto day)`,
            );
          }
          return false;
        }
      }

      count = await this.incrWithTtl(`${VERIFICATION_KEY_PREFIX}${day}`);
      if (count > this.verificationDailyBudget && isFirst) {
        await this.redis.del(firstKey);
      }
    } catch {
      return true;
    }

    const cap = this.verificationDailyBudget;
    if (count === Math.ceil(cap * WARN_AT_RATIO)) {
      this.logger.warn(
        `Email verification budget at ${count}/${cap} for today (Toronto day); at the cap, sending answers 503`,
      );
    }
    if (
      count === VERIFICATION_EARLY_ALERT_THRESHOLD + 1 &&
      budgetHour(new Date()) < VERIFICATION_EARLY_ALERT_HOUR
    ) {
      this.logger.warn(
        `ALERT: ${count} email verification sends before noon (Toronto day), cap ${cap}; ` +
          'check for scripted sign-ups (docs/deploy/arret-urgence.md)',
      );
    }
    if (count > cap) {
      if (count === cap + 1) {
        this.logger.warn(
          `Email verification budget exhausted (${count}/${cap}) for today (Toronto day)`,
        );
      }
      return false;
    }
    return true;
  }

  private async incrWithTtl(key: string): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, KEY_TTL_SECONDS);
    }
    return count;
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
