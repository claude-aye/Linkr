import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE, EmailJob } from '../../queue/queue.constants';
import { EmailTemplateName, EmailTemplateVars } from './templates';
import { DEFAULT_LOCALE, Locale } from './templates/types';

export interface SendEmailInput<TName extends EmailTemplateName> {
  to: string;
  /** A key of the template registry — anything else fails to compile. */
  template: TName;
  /** Exactly the vars that template declares, checked against it. */
  vars: EmailTemplateVars<TName>;
  /** Defaults to fr-CA; nothing stores a per-user preference yet. */
  locale?: Locale;
}

/**
 * The only way to send an email in this codebase — and it does not send
 * anything. It enqueues.
 *
 * ⚠️ No SMTP call ever happens inside an HTTP request. A relay that is slow or
 * down would otherwise turn every signup into a slow signup, and a delivery
 * failure into a failed signup. The transport lives in the worker, behind
 * retries; this class knows neither Nodemailer nor SMTP and must not learn.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJob>,
  ) {}

  async send<TName extends EmailTemplateName>(
    input: SendEmailInput<TName>,
  ): Promise<void> {
    const locale = input.locale ?? DEFAULT_LOCALE;

    const job = await this.queue.add(input.template, {
      to: input.to,
      template: input.template,
      vars: input.vars,
      locale,
    });

    // Recipient and template only. `vars` is never logged: in A-2 it carries a
    // password-reset token, and a log line is the one place a secret outlives
    // every retention policy written for the store it came from.
    this.logger.log(
      `Queued "${input.template}" for ${input.to} (${locale}) as job ${job.id}`,
    );
  }
}
