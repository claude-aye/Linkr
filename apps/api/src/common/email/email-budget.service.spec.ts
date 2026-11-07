import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { EmailJob } from '../../queue/queue.constants';
import {
  ESSENTIAL_EMAIL_PRIORITY,
  EmailBudgetService,
  NON_ESSENTIAL_EMAIL_PRIORITY,
} from './email-budget.service';
import { EmailService } from './email.service';

/** In-memory stand-in for the two Redis commands the budget uses. */
const fakeRedis = (opts: { down?: boolean } = {}) => {
  const counters = new Map<string, number>();
  const expiries = new Map<string, number>();
  const redis = {
    incr: jest.fn(async (key: string) => {
      if (opts.down) throw new Error('Redis is down');
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    expire: jest.fn(async (key: string, seconds: number) => {
      expiries.set(key, seconds);
      return 1;
    }),
  };
  return { redis: redis as unknown as Redis, counters, expiries, raw: redis };
};

const config = (budget?: number) =>
  ({
    get: (key: string, fallback?: unknown) =>
      key === 'EMAIL_DAILY_BUDGET' && budget !== undefined ? budget : fallback,
  }) as unknown as ConfigService;

const NON_ESSENTIAL = 'direct-booking' as const;

describe('EmailBudgetService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2026-11-06T15:00:00Z'),
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('allows non-essential emails under the cap, with no warning', async () => {
    const { redis } = fakeRedis();
    const budget = new EmailBudgetService(redis, config(10));

    for (let i = 0; i < 7; i++) {
      await expect(budget.allow(NON_ESSENTIAL)).resolves.toBe(true);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('allows the email that reaches the cap, and refuses the next one', async () => {
    const { redis } = fakeRedis();
    const budget = new EmailBudgetService(redis, config(10));

    for (let i = 0; i < 10; i++) {
      await expect(budget.allow(NON_ESSENTIAL)).resolves.toBe(true);
    }
    await expect(budget.allow(NON_ESSENTIAL)).resolves.toBe(false);
    await expect(budget.allow(NON_ESSENTIAL)).resolves.toBe(false);
  });

  it('warns once, at 80 %, and not again that day', async () => {
    const { redis } = fakeRedis();
    const budget = new EmailBudgetService(redis, config(10));

    for (let i = 0; i < 10; i++) await budget.allow(NON_ESSENTIAL);

    const eighty = warn.mock.calls.filter(([m]) => String(m).includes('budget at'));
    expect(eighty).toHaveLength(1);
    expect(String(eighty[0][0])).toContain('8/10');
  });

  it('writes one WARN per dropped email: template and counter, never an address', async () => {
    const { redis } = fakeRedis();
    const budget = new EmailBudgetService(redis, config(2));

    await budget.allow(NON_ESSENTIAL);
    await budget.allow(NON_ESSENTIAL);
    await budget.allow(NON_ESSENTIAL);

    const dropped = warn.mock.calls.filter(([m]) => String(m).includes('daily budget exhausted'));
    expect(dropped).toHaveLength(1);
    expect(String(dropped[0][0])).toContain('"direct-booking"');
    expect(String(dropped[0][0])).toContain('3/2');
    expect(String(dropped[0][0])).not.toMatch(/@/);
  });

  it.each(['password-reset', 'deposit-failed-client', 'balance-failed-client'] as const)(
    'never counts or blocks the essential "%s", even far past the cap',
    async (template) => {
      const { redis, raw, counters } = fakeRedis();
      const budget = new EmailBudgetService(redis, config(1));

      await budget.allow(NON_ESSENTIAL);
      await budget.allow(NON_ESSENTIAL); // over the cap now
      raw.incr.mockClear();

      for (let i = 0; i < 50; i++) {
        await expect(budget.allow(template)).resolves.toBe(true);
      }
      expect(raw.incr).not.toHaveBeenCalled();
      expect([...counters.values()]).toEqual([2]);
    },
  );

  it.each([
    // Winter (EST, UTC-5): midnight Toronto = 05:00Z.
    ['winter', '2026-11-07T04:59:00Z', '2026-11-07T05:01:00Z', '2026-11-06', '2026-11-07'],
    // Summer (EDT, UTC-4): midnight Toronto = 04:00Z.
    ['summer', '2026-07-15T03:59:00Z', '2026-07-15T04:01:00Z', '2026-07-14', '2026-07-15'],
  ])(
    'rolls over at local midnight in Toronto, not UTC (%s)',
    async (_season, before, after, dayBefore, dayAfter) => {
      const { redis, counters } = fakeRedis();
      const budget = new EmailBudgetService(redis, config(2));

      jest.setSystemTime(new Date(before)); // 23:59 in Toronto
      await budget.allow(NON_ESSENTIAL);
      await budget.allow(NON_ESSENTIAL);
      await expect(budget.allow(NON_ESSENTIAL)).resolves.toBe(false);

      jest.setSystemTime(new Date(after)); // 00:01 in Toronto
      await expect(budget.allow(NON_ESSENTIAL)).resolves.toBe(true);

      expect([...counters.keys()].sort()).toEqual([
        `linkr:email-budget:v1:${dayBefore}`,
        `linkr:email-budget:v1:${dayAfter}`,
      ]);
    },
  );

  it('does not roll over at midnight UTC (19:00 in Toronto in winter)', async () => {
    const { redis, counters } = fakeRedis();
    const budget = new EmailBudgetService(redis, config(5));

    jest.setSystemTime(new Date('2026-11-06T23:59:00Z'));
    await budget.allow(NON_ESSENTIAL);
    jest.setSystemTime(new Date('2026-11-07T00:01:00Z'));
    await budget.allow(NON_ESSENTIAL);

    expect([...counters.entries()]).toEqual([['linkr:email-budget:v1:2026-11-06', 2]]);
  });

  it('gives the key an expiry on first use only', async () => {
    const { redis, raw } = fakeRedis();
    const budget = new EmailBudgetService(redis, config(5));

    await budget.allow(NON_ESSENTIAL);
    await budget.allow(NON_ESSENTIAL);

    expect(raw.expire).toHaveBeenCalledTimes(1);
  });

  it('defaults to 200 when the variable is absent', async () => {
    const { redis } = fakeRedis();
    const budget = new EmailBudgetService(redis, config());

    for (let i = 0; i < 200; i++) await budget.allow(NON_ESSENTIAL);
    await expect(budget.allow(NON_ESSENTIAL)).resolves.toBe(false);
  });

  it('fails open when Redis is unreachable: the email is allowed, no warning', async () => {
    const { redis } = fakeRedis({ down: true });
    const budget = new EmailBudgetService(redis, config(1));

    await expect(budget.allow(NON_ESSENTIAL)).resolves.toBe(true);
    await expect(budget.allow(NON_ESSENTIAL)).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ranks essentials ahead of everything else (lower number runs first)', () => {
    const budget = new EmailBudgetService(fakeRedis().redis, config());
    expect(budget.priorityFor('password-reset')).toBe(ESSENTIAL_EMAIL_PRIORITY);
    expect(budget.priorityFor(NON_ESSENTIAL)).toBe(NON_ESSENTIAL_EMAIL_PRIORITY);
    expect(ESSENTIAL_EMAIL_PRIORITY).toBeLessThan(NON_ESSENTIAL_EMAIL_PRIORITY);
    expect(ESSENTIAL_EMAIL_PRIORITY).toBeGreaterThan(0);
  });
});

describe('EmailService with the budget', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  const harness = (cap: number, down = false) => {
    const { redis } = fakeRedis({ down });
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const queue = { add } as unknown as Queue<EmailJob>;
    const service = new EmailService(queue, new EmailBudgetService(redis, config(cap)));
    return { service, add };
  };

  const bookingVars = { firstName: 'Dana', dashboardUrl: 'https://linkr.test/dashboard' };
  const resetVars = {
    firstName: 'Dana',
    resetUrl: 'https://linkr.test/reset-password?token=t',
    expiresInMinutes: 60,
  };

  it('queues a non-essential email under the cap, with the lower priority', async () => {
    const { service, add } = harness(5);

    await service.send({ to: 'a@linkr.test', template: 'direct-booking', vars: bookingVars });

    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][2]).toEqual({ priority: NON_ESSENTIAL_EMAIL_PRIORITY });
  });

  it('drops a non-essential email over the cap: not queued, no throw', async () => {
    const { service, add } = harness(1);

    await service.send({ to: 'a@linkr.test', template: 'direct-booking', vars: bookingVars });
    await expect(
      service.send({ to: 'b@linkr.test', template: 'direct-booking', vars: bookingVars }),
    ).resolves.toBeUndefined();

    expect(add).toHaveBeenCalledTimes(1);
  });

  it('still queues a password reset over the cap, with the higher priority', async () => {
    const { service, add } = harness(1);

    await service.send({ to: 'a@linkr.test', template: 'direct-booking', vars: bookingVars });
    await service.send({ to: 'b@linkr.test', template: 'direct-booking', vars: bookingVars });
    await service.send({ to: 'c@linkr.test', template: 'password-reset', vars: resetVars });

    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[1][0]).toBe('password-reset');
    expect(add.mock.calls[1][2]).toEqual({ priority: ESSENTIAL_EMAIL_PRIORITY });
  });

  it('leaves retries untouched: the only per-job option is the priority', async () => {
    const { service, add } = harness(5);
    await service.send({ to: 'a@linkr.test', template: 'password-reset', vars: resetVars });
    expect(Object.keys(add.mock.calls[0][2])).toEqual(['priority']);
  });

  it('with Redis down, the queue is asked exactly as before', async () => {
    const { service, add } = harness(1, true);

    await service.send({ to: 'a@linkr.test', template: 'direct-booking', vars: bookingVars });
    await service.send({ to: 'b@linkr.test', template: 'direct-booking', vars: bookingVars });

    expect(add).toHaveBeenCalledTimes(2);
  });
});
