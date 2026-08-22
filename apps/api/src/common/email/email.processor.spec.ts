import { Job } from 'bullmq';
import { EmailProcessor } from './email.processor';
import { EmailJob } from '../../queue/queue.constants';
import { EmailMessage, IEmailSender } from './senders/email-sender.interface';

/**
 * Locks the one decision in this module that looks wrong until you read the
 * BullMQ source: a definitive failure is derived from `finishedOn`, NOT from
 * `attemptsMade >= opts.attempts`.
 *
 * The tempting "simplification" is silent — it produces a warning instead of an
 * error for a job that will never be retried, so the permanent-failure line the
 * hook exists to write never appears. These tests fail if anyone makes it.
 */

/** The shape `@OnWorkerEvent('failed')` actually reads off a job. */
function failedJob(overrides: {
  attemptsMade: number;
  attempts?: number;
  finishedOn?: number | null;
}): Job<EmailJob> {
  return {
    id: 'job-1',
    data: {
      to: 'destinataire@linkr.test',
      template: 'probe',
      vars: { label: 'x', enqueuedAtUtc: '2026-08-22T00:00:00.000Z' },
      locale: 'fr-CA',
    },
    opts: { attempts: overrides.attempts ?? 3 },
    attemptsMade: overrides.attemptsMade,
    finishedOn: overrides.finishedOn ?? undefined,
  } as unknown as Job<EmailJob>;
}

describe('EmailProcessor.onFailed', () => {
  const sender: IEmailSender = { send: async (_: EmailMessage) => undefined };
  let processor: EmailProcessor;
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    processor = new EmailProcessor(sender);
    const logger = processor['logger'];
    error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('warns, without claiming failure, while attempts remain', () => {
    processor.onFailed(
      failedJob({ attemptsMade: 1, finishedOn: null }),
      new Error('ECONNREFUSED'),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('attempt 1/3');
  });

  it('reports a permanent failure once the attempts are spent', () => {
    processor.onFailed(
      failedJob({ attemptsMade: 3, finishedOn: Date.now() }),
      new Error('ECONNREFUSED'),
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error.mock.calls[0][0]).toContain('PERMANENTLY FAILED');
  });

  it('reports a permanent failure after ONE attempt when BullMQ gave up early', () => {
    // The unrecoverable case (an unknown template). `attemptsMade` is 1 of 3,
    // so an attempts comparison would call this a retry and log nothing at
    // ERROR — the job would die unmentioned. `finishedOn` is what catches it.
    processor.onFailed(
      failedJob({ attemptsMade: 1, attempts: 3, finishedOn: Date.now() }),
      new Error('Unknown email template "nope"'),
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error.mock.calls[0][0]).toContain('after 1 attempt(s)');
  });

  it('still logs when BullMQ emits with no job attached', () => {
    processor.onFailed(undefined, new Error('lock lost'));

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('no job attached');
  });
});
