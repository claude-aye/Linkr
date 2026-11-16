import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { EmailBudgetService } from './email-budget.service';
import { OpsAlertService } from './ops-alert.service';
import { opsAlertEmail } from './templates/ops-alert.template';

const ADDRESS = 'ops@example.test';

const fakeRedis = (opts: { down?: boolean } = {}) => {
  const counters = new Map<string, number>();
  const marks = new Set<string>();
  const redis = {
    incr: jest.fn(async (k: string) => {
      if (opts.down) throw new Error('down');
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      return n;
    }),
    expire: jest.fn(async () => 1),
    get: jest.fn(async (k: string) => {
      if (opts.down) throw new Error('down');
      return counters.has(k) ? String(counters.get(k)) : null;
    }),
    set: jest.fn(async (k: string) => {
      if (opts.down) throw new Error('down');
      if (marks.has(k)) return null;
      marks.add(k);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => (marks.delete(k) ? 1 : 0)),
  };
  return { redis: redis as unknown as Redis, counters };
};

const config = (values: Record<string, unknown> = {}) =>
  ({ get: (k: string, fb?: unknown) => (k in values ? values[k] : fb) }) as unknown as ConfigService;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
};

type AddCall = [string, { vars: Record<string, unknown> }];

function build(opts: { cfg?: Record<string, unknown>; down?: boolean; queueFails?: boolean } = {}) {
  const { redis, counters } = fakeRedis({ down: opts.down });
  const queue = {
    add: jest.fn(async (..._args: unknown[]) => {
      if (opts.queueFails) throw new Error('queue down');
      return { id: '1' };
    }),
  };
  const cfg = { OPS_ALERT_EMAIL: ADDRESS, ...opts.cfg };
  const ops = new OpsAlertService(queue as never, redis, config(cfg));
  const budget = new EmailBudgetService(
    redis,
    config({ EMAIL_VERIFICATION_DAILY_BUDGET: 60 }),
    ops,
  );
  return { budget, queue, counters };
}

const setTime = (iso: string) =>
  jest.useFakeTimers({ now: new Date(iso), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });

describe('Mandate J — operator quota alert', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const m of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation(((msg: unknown) => {
        logs.push(String(msg));
      }) as never);
    }
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('noon threshold: alerts once, at the 31st send, before noon (Toronto)', async () => {
    setTime('2026-11-15T15:00:00Z'); // 10:00 Toronto
    const { budget, queue } = build();
    for (let i = 0; i < 40; i++) await budget.reserveVerification(`u${i}`);
    await flush();
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, job] = queue.add.mock.calls[0] as unknown as AddCall;
    expect(job.vars.trigger).toBe('noon-threshold');
    expect(job.vars.count).toBe(31);
  });

  it('noon threshold: no alert when the 31st send is after noon', async () => {
    setTime('2026-11-15T18:00:00Z'); // 13:00 Toronto
    const { budget, queue } = build();
    for (let i = 0; i < 40; i++) await budget.reserveVerification(`u${i}`);
    await flush();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('saturation: alerts once at the first refusal, at any hour', async () => {
    setTime('2026-11-15T22:00:00Z'); // 17:00 Toronto
    const { budget, queue } = build();
    for (let i = 0; i < 70; i++) await budget.reserveVerification(`u${i}`);
    await flush();
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, job] = queue.add.mock.calls[0] as unknown as AddCall;
    expect(job.vars).toMatchObject({ trigger: 'saturation', count: 61, cap: 60 });
  });

  it('the day mark makes a repeated trigger a no-op', async () => {
    setTime('2026-11-15T22:00:00Z');
    const { redis } = fakeRedis();
    const queue = { add: jest.fn(async (..._a: unknown[]) => ({ id: '1' })) };
    const ops = new OpsAlertService(queue as never, redis, config({ OPS_ALERT_EMAIL: ADDRESS }));
    const input = {
      trigger: 'saturation' as const,
      count: 61,
      cap: 60,
      resends: 0,
      resendCap: 20,
      torontoTime: 'x',
      environment: 'test',
      day: '2026-11-15',
    };
    await ops.alert(input);
    await ops.alert(input);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('empty or absent OPS_ALERT_EMAIL: no email, WARN lines kept', async () => {
    setTime('2026-11-15T22:00:00Z');
    for (const cfg of [{ OPS_ALERT_EMAIL: '' }, { OPS_ALERT_EMAIL: undefined }]) {
      const { budget, queue } = build({ cfg });
      for (let i = 0; i < 70; i++) await budget.reserveVerification(`u${i}`);
      await flush();
      expect(queue.add).not.toHaveBeenCalled();
    }
    expect(logs.some((l) => l.includes('budget exhausted'))).toBe(true);
  });

  it('queue failure never alters the reservation answers', async () => {
    setTime('2026-11-15T22:00:00Z');
    const { budget } = build({ queueFails: true });
    const answers: boolean[] = [];
    for (let i = 0; i < 62; i++) answers.push(await budget.reserveVerification(`u${i}`));
    await flush();
    expect(answers.slice(0, 60).every(Boolean)).toBe(true);
    expect(answers.slice(60)).toEqual([false, false]);
  });

  it('Redis unreachable: no alert email', async () => {
    setTime('2026-11-15T22:00:00Z');
    const { budget, queue } = build({ down: true });
    for (let i = 0; i < 5; i++) expect(await budget.reserveVerification(`u${i}`)).toBe(true);
    await flush();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('the alert counts in no cap', async () => {
    setTime('2026-11-15T22:00:00Z');
    const { budget, counters } = build();
    for (let i = 0; i < 61; i++) await budget.reserveVerification(`u${i}`);
    await flush();
    const total = [...counters].find(([k]) => k.startsWith('linkr:email-verification-budget:'))?.[1];
    expect(total).toBe(61);
    expect([...counters.keys()].some((k) => k.includes('resend'))).toBe(false);
    expect([...counters.keys()].some((k) => k.startsWith('linkr:email-budget:'))).toBe(false);
  });

  it('content and logs carry no address and no account id', async () => {
    setTime('2026-11-15T22:00:00Z');
    const { budget, queue } = build();
    for (let i = 0; i < 61; i++) await budget.reserveVerification(`secret-user-${i}`);
    await flush();
    const [, job] = queue.add.mock.calls[0] as unknown as AddCall;
    const rendered = opsAlertEmail(job.vars as never);
    const everything = JSON.stringify([rendered, job.vars, logs]);
    expect(everything).not.toContain(ADDRESS);
    expect(everything).not.toContain('secret-user');
    expect(everything).not.toContain('@');
    expect(rendered.subject).toBe('[Linkr] Quota de confirmation : saturation');
  });
});
