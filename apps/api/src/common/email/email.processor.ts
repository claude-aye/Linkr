import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { EMAIL_QUEUE, EmailJob } from '../../queue/queue.constants';
import { EMAIL_SENDER, IEmailSender } from './senders/email-sender.interface';
import { EMAIL_TEMPLATES, isEmailTemplateName } from './templates';
import { EmailTemplate, EmailVars } from './templates/types';

/**
 * Consumes the "email" queue: renders the template, hands the result to the
 * transport. Rendering happens HERE and not at enqueue time — the payload
 * travels as `{ to, template, vars, locale }`, so a template can be corrected
 * without invalidating the jobs already waiting behind it.
 */
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(@Inject(EMAIL_SENDER) private readonly sender: IEmailSender) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const { to, template, vars, locale } = job.data;

    if (!isEmailTemplateName(template)) {
      // Retrying cannot fix a name that is not in the registry: the payload is
      // already written and the registry only changes with a deploy. Failing
      // unrecoverably reports it on the FIRST attempt instead of burning two
      // more and delaying the log by fifteen seconds.
      throw new UnrecoverableError(`Unknown email template "${template}"`);
    }

    // The registry is a union of concrete template functions; `vars` came back
    // off the wire as EmailVars. The guard above proved the name, and the
    // producer's signature proved the vars matched it at the call site — this
    // widening is where those two proofs meet again.
    const render = EMAIL_TEMPLATES[template] as EmailTemplate<EmailVars>;
    const rendered = render(vars, locale);

    await this.sender.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    this.logger.log(`Sent "${template}" to ${to} (${locale})`);
  }

  /**
   * A definitively failed email must leave a log entry. Without one, a mail
   * that never goes out has NO symptom: nobody notices an inbox staying empty,
   * least of all the person waiting for a password reset.
   *
   * ⚠️ BullMQ emits `failed` on EVERY attempt, so "definitive" has to be
   * derived — and the derivation is `job.finishedOn`, NOT
   * `attemptsMade >= opts.attempts`. The difference is not academic. BullMQ
   * stops retrying when the attempts run out **or** when the error is an
   * UnrecoverableError (`shouldRetryJob`, bullmq/classes/job.js), and only the
   * branch that really gives up stamps `finishedOn`. An attempts comparison
   * would read our own unknown-template failure — which stops after ONE
   * attempt by design — as "will retry", and that job would never produce the
   * line this hook exists to write. `attemptsMade` is already incremented when
   * the event fires, so it is the honest attempt COUNT to report; it is simply
   * not the retry PREDICATE.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailJob> | undefined, error: Error): void {
    const reason = error?.message ?? 'unknown error';

    if (!job) {
      // BullMQ can emit `failed` with no job attached (a lost lock, say).
      // Thin, but a line beats silence.
      this.logger.error(`Email job failed with no job attached: ${reason}`);
      return;
    }

    // Defensive: this hook exists so a dead email is never silent, so it must
    // not be the thing that throws. A malformed job still gets a line.
    const { to, template } = job.data ?? {};
    const attempts = job.opts?.attempts ?? 1;

    if (job.finishedOn == null) {
      this.logger.warn(
        `Email "${template}" to ${to} failed on attempt ${job.attemptsMade}/${attempts}, will retry: ${reason}`,
      );
      return;
    }

    this.logger.error(
      `Email PERMANENTLY FAILED after ${job.attemptsMade} attempt(s): ` +
        `"${template}" to ${to} (job ${job.id}) — ${reason}`,
    );
  }
}
