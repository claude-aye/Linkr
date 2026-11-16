import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { EMAIL_QUEUE, EmailJob } from '../../queue/queue.constants';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { OpsAlertEmailVars } from './templates/ops-alert.template';
import { DEFAULT_LOCALE } from './templates/types';

/** Same priority as the other essentials (lower runs first). */
const OPS_ALERT_PRIORITY = 1;
/** The mark outlives its Toronto day so a late call never re-alerts. */
const MARK_TTL_SECONDS = 2 * 24 * 60 * 60;
const MARK_PREFIX = 'linkr:ops-alert:v1:';

export type OpsAlertInput = OpsAlertEmailVars & {
  /** AAAA-MM-JJ on the Toronto calendar: one alert per trigger per day. */
  day: string;
};

/**
 * Operator alert by email (mandate J). The quota WARN lines were written to
 * logs nobody reads; this also tells the operator.
 *
 * ⚠️ Deliberately NOT built on EmailService: that would run the alert through
 * the budget it reports on (and EmailService already depends on the budget,
 * which calls this — a cycle). The job goes straight to the email queue, so it
 * counts in no cap and meets none of the resend guards.
 *
 * ⚠️ NEVER THROWS, NEVER BLOCKS THE CALLER. Callers do not await it; every
 * failure is logged (class name only) and swallowed. Redis unreachable → the
 * once-a-day mark cannot be taken → no email (the WARN stays), so a Redis
 * outage cannot flood the inbox.
 *
 * ⚠️ OPS_ALERT_EMAIL is never logged, here or anywhere.
 */
@Injectable()
export class OpsAlertService {
  private readonly logger = new Logger(OpsAlertService.name);
  private readonly recipient: string | null;

  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJob>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() configService?: ConfigService,
  ) {
    const raw = configService?.get<string>('OPS_ALERT_EMAIL');
    this.recipient = raw && raw.trim() !== '' ? raw.trim() : null;
    this.logger.log(
      `Ops quota alert by email: ${this.recipient ? 'enabled' : 'disabled (OPS_ALERT_EMAIL empty)'}`,
    );
  }

  async alert(input: OpsAlertInput): Promise<void> {
    if (!this.recipient) return;
    const { day, ...vars } = input;
    try {
      const taken = await this.redis.set(
        `${MARK_PREFIX}${day}:${vars.trigger}`,
        '1',
        'EX',
        MARK_TTL_SECONDS,
        'NX',
      );
      if (taken !== 'OK') return;
      await this.queue.add(
        'ops-alert',
        { to: this.recipient, template: 'ops-alert', vars, locale: DEFAULT_LOCALE },
        { priority: OPS_ALERT_PRIORITY },
      );
    } catch (err) {
      this.logger.warn(
        `Ops alert (${vars.trigger}) not queued: ${err instanceof Error ? err.name : 'error'}`,
      );
    }
  }
}
