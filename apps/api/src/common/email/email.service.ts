import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE, EmailJob } from '../../queue/queue.constants';
import { EmailBudgetService } from './email-budget.service';
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
    private readonly budget: EmailBudgetService,
  ) {}

  async send<TName extends EmailTemplateName>(
    input: SendEmailInput<TName>,
  ): Promise<void> {
    const locale = input.locale ?? DEFAULT_LOCALE;

    // Daily budget for NON-essential emails (password-reset and the two
    // payment-failure emails are exempt). Over the cap the email is dropped
    // here — a WARN without address was already written — and the caller
    // carries on exactly as if it had been queued.
    if (!(await this.budget.allow(input.template))) {
      return;
    }

    const job = await this.queue.add(
      input.template,
      {
        to: input.to,
        template: input.template,
        vars: input.vars,
        locale,
      },
      // Essentials first. Retries and backoff come from EMAIL_JOB_OPTIONS and
      // are deliberately untouched.
      { priority: this.budget.priorityFor(input.template) },
    );

    // Template, locale and job id only. Neither the recipient address nor
    // `vars` is ever logged: the address is personal information, and `vars`
    // carries a password-reset token. A log line outlives every retention
    // policy written for the store it came from.
    this.logger.log(
      `Queued "${input.template}" (${locale}) as job ${job.id}`,
    );
  }
}
