import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { EmailBudgetService } from '../../common/email/email-budget.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SignupDto } from './dtos/signup.dto';
import {
  EMAIL_VERIFICATION_BUDGET_EXHAUSTED,
  EMAIL_VERIFICATION_SEND_FAILED,
  EMAIL_VERIFICATION_TOKEN_INVALID,
} from './email-verification.exceptions';
import {
  ENQUEUE_TIMEOUT_MS,
  EmailVerificationService,
  RESEND_LIMITS,
  VERIFY_EMAIL_PATH,
} from './email-verification.service';
import { EmailVerificationTokenRepository } from './email-verification-token.repository';
import { PasswordResetTokenRepository } from './password-reset-token.repository';
import { hashToken } from './token-hash';

/** Lets fire-and-forget work (sign-up's mail) run to completion. */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
};

/**
 * Mandate L1 — email verification. SQL rules (expiry, single use, old address,
 * rotation, concurrency, reset side effect) are proven against a real Postgres
 * by `src/database/probes/email-verification.probe.ts`; this spec covers what
 * lives in TypeScript and the wiring.
 */

const EMAIL = 'camille.secret@example.test';
const USER = {
  id: 'user-1',
  email: EMAIL,
  firstName: 'Camille',
  emailVerifiedAtUtc: null as Date | null,
};

const config = (values: Record<string, unknown> = {}) =>
  ({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
    getOrThrow: (key: string) => {
      if (key === 'WEB_APP_BASE_URL') return 'https://linkrapp.test/';
      if (key in values) return values[key];
      throw new Error(`missing ${key}`);
    },
  }) as unknown as ConfigService;

const fakeRedis = (opts: { down?: boolean } = {}) => {
  const counters = new Map<string, number>();
  const redis = {
    incr: jest.fn(async (key: string) => {
      if (opts.down) throw new Error('down');
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    expire: jest.fn(async () => 1),
  };
  return { redis: redis as unknown as Redis, counters };
};

function build(opts: {
  user?: typeof USER | null;
  budgetAllows?: boolean;
  send?: jest.Mock;
  consume?: string | null;
} = {}) {
  const usersRepository = {
    findById: jest.fn().mockResolvedValue(opts.user === undefined ? { ...USER } : opts.user),
    findByEmail: jest.fn(),
  };
  let seq = 0;
  const tokenRepository = {
    insert: jest.fn(async (_userId: string, _email: string, _hash: string, _expires: Date) => ({
      id: `tok-${(seq += 1)}`,
      createdAtUtc: new Date(),
    })),
    expire: jest.fn().mockResolvedValue(undefined),
    expireOlderLive: jest.fn().mockResolvedValue(undefined),
    consumeAndVerify: jest.fn().mockResolvedValue(opts.consume === undefined ? 'user-1' : opts.consume),
  };
  const emailService = { send: opts.send ?? jest.fn().mockResolvedValue(undefined) };
  const budget = {
    reserveVerification: jest.fn().mockResolvedValue(opts.budgetAllows ?? true),
  };
  const service = new EmailVerificationService(
    usersRepository as never,
    tokenRepository as never,
    emailService as never,
    budget as never,
    config(),
  );
  return { service, usersRepository, tokenRepository, emailService, budget };
}

const codeOf = (error: unknown) =>
  ((error as HttpException).getResponse() as { code?: string }).code;

let logged: string[];
beforeEach(() => {
  logged = [];
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => jest.restoreAllMocks());

describe('verify', () => {
  it('valid token → resolves, looked up by its SHA-256', async () => {
    const { service, tokenRepository } = build();
    await service.verify('raw-token');
    expect(tokenRepository.consumeAndVerify).toHaveBeenCalledWith(hashToken('raw-token'));
  });

  it('expired, reused, unknown or old-address token (repository null) → one 400 with the stable code', async () => {
    const { service } = build({ consume: null });
    const error = await service.verify('raw-token').catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(400);
    expect(codeOf(error)).toBe(EMAIL_VERIFICATION_TOKEN_INVALID);
  });
});

describe('resend', () => {
  it('looks the user up BY ID, never by address', async () => {
    const { service, usersRepository } = build();
    await service.resend('user-1');
    expect(usersRepository.findById).toHaveBeenCalledWith('user-1');
    expect(usersRepository.findByEmail).not.toHaveBeenCalled();
  });

  it('already verified → ALREADY_VERIFIED, nothing reserved, no token, no mail', async () => {
    const { service, budget, tokenRepository, emailService } = build({
      user: { ...USER, emailVerifiedAtUtc: new Date() },
    });
    await expect(service.resend('user-1')).resolves.toBe('ALREADY_VERIFIED');
    expect(budget.reserveVerification).not.toHaveBeenCalled();
    expect(tokenRepository.insert).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('rotates with the account address and queues the essential template with the fixed link', async () => {
    const { service, tokenRepository, emailService } = build();
    await expect(service.resend('user-1')).resolves.toBe('SENT');
    const [userId, email, tokenHash, expiresAt] = tokenRepository.insert.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(email).toBe(EMAIL);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const ttl = expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23.9 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3600_000);
    const sent = emailService.send.mock.calls[0][0];
    expect(sent.template).toBe('email-verification');
    expect(sent.vars.verifyUrl).toMatch(
      new RegExp(`^https://linkrapp\\.test${VERIFY_EMAIL_PATH}\\?token=[A-Za-z0-9_-]{43}$`),
    );
    // The hash stored is the hash of the token in the link.
    const raw = new URL(sent.vars.verifyUrl).searchParams.get('token')!;
    expect(hashToken(raw)).toBe(tokenHash);
  });

  it('two resends issue two different tokens (rotation happens in the repository)', async () => {
    const { service, tokenRepository } = build();
    await service.resend('user-1');
    await service.resend('user-1');
    const [a, b] = tokenRepository.insert.mock.calls.map((c) => c[2]);
    expect(a).not.toBe(b);
  });

  it('budget spent → 503 with the stable code, and NO token created', async () => {
    const { service, tokenRepository, emailService } = build({ budgetAllows: false });
    const error = await service.resend('user-1').catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(503);
    expect(codeOf(error)).toBe(EMAIL_VERIFICATION_BUDGET_EXHAUSTED);
    expect(tokenRepository.insert).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });
});

describe('resend limits', () => {
  it(`allows ${RESEND_LIMITS.PER_USER_PER_DAY} a day per user, then refuses with a Retry-After`, () => {
    const { service } = build();
    for (let i = 0; i < RESEND_LIMITS.PER_USER_PER_DAY; i += 1) {
      expect(service.checkResendLimits('user-1', `10.0.0.${i}`).allowed).toBe(true);
    }
    const refused = service.checkResendLimits('user-1', '10.0.0.99');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(23 * 3600);
    // Another user is unaffected.
    expect(service.checkResendLimits('user-2', '10.0.1.1').allowed).toBe(true);
  });

  it(`allows ${RESEND_LIMITS.PER_IP_PER_HOUR} an hour per IP across users`, () => {
    const { service } = build();
    for (let i = 0; i < RESEND_LIMITS.PER_IP_PER_HOUR; i += 1) {
      expect(service.checkResendLimits(`user-${i}`, '203.0.113.7').allowed).toBe(true);
    }
    const refused = service.checkResendLimits('user-x', '203.0.113.7');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it('controller answers 429 with Retry-After and never calls resend', async () => {
    const verification = {
      checkResendLimits: jest.fn().mockReturnValue({ allowed: false, retryAfterSeconds: 120 }),
      resend: jest.fn(),
    };
    const controller = new AuthController({} as never, {} as never, verification as never);
    const res = { header: jest.fn() };
    const error = await controller
      .resendVerification({ sub: 'user-1' } as never, { ip: '1.2.3.4' } as never, res as never)
      .catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(res.header).toHaveBeenCalledWith('Retry-After', '120');
    expect(verification.resend).not.toHaveBeenCalled();
  });
});

describe('signup', () => {
  const body = {
    email: EMAIL,
    password: 'Password123!',
    firstName: 'Camille',
    lastName: 'R',
    countryCode: 'CA',
    subdivisionCode: 'CA-QC',
    preferredCurrency: 'CAD',
  } as unknown as SignupDto;

  function buildSignup(verification: EmailVerificationService) {
    const createWithEmailPassword = jest
      .fn()
      .mockImplementation(async (data) => ({ id: 'user-1', ...data, emailVerifiedAtUtc: null }));
    const usersRepository = {
      findByEmail: jest.fn().mockResolvedValue(null),
      createWithEmailPassword,
    };
    const service = new AuthService(
      { sign: jest.fn().mockReturnValue('signed') } as never,
      { getOrThrow: jest.fn().mockReturnValue('secret'), get: jest.fn() } as never,
      usersRepository as never,
      verification,
    );
    jest.spyOn(service, 'hashPassword').mockResolvedValue('hash');
    return { service, createWithEmailPassword };
  }

  it('budget spent → 503 BEFORE the account is created', async () => {
    const { service: verification } = build({ budgetAllows: false });
    const { service, createWithEmailPassword } = buildSignup(verification);
    const error = await service.signup(body).catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(503);
    expect(codeOf(error)).toBe(EMAIL_VERIFICATION_BUDGET_EXHAUSTED);
    expect(createWithEmailPassword).not.toHaveBeenCalled();
  });

  it('sends the verification mail after creating the account, and exposes emailVerified=false', async () => {
    const { service: verification, emailService } = build();
    const { service } = buildSignup(verification);
    const response = await service.signup(body);
    await flush();
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(response.user.emailVerified).toBe(false);
  });

  it('a send failure does NOT fail the sign-up, and the log carries neither address nor token', async () => {
    const send = jest.fn().mockRejectedValue(new Error(`SMTP refused ${EMAIL}`));
    const { service: verification } = build({ send });
    const { service } = buildSignup(verification);
    await expect(service.signup(body)).resolves.toHaveProperty('accessToken');
    await flush();
    const sentUrl = send.mock.calls[0][0].vars.verifyUrl as string;
    const raw = new URL(sentUrl).searchParams.get('token')!;
    expect(logged.some((l) => l.includes('could not be queued'))).toBe(true);
    expect(logged.join('\n')).not.toContain(EMAIL);
    expect(logged.join('\n')).not.toContain(raw);
  });

  it('L1b: an enqueue that NEVER answers does not hold the sign-up', async () => {
    const send = jest.fn(() => new Promise<void>(() => undefined));
    const { service: verification } = build({ send });
    const { service } = buildSignup(verification);
    const result = await Promise.race([
      service.signup(body).then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 500)),
    ]);
    expect(result).toBe('answered');
  });
});

describe('L1b — resend: queue first, rotate after', () => {
  it('order on success: insert → send → expire OLDER live tokens of that user', async () => {
    const { service, tokenRepository, emailService } = build();
    await service.resend('user-1');
    const [insertAt] = tokenRepository.insert.mock.invocationCallOrder;
    const [sendAt] = emailService.send.mock.invocationCallOrder;
    const [expireAt] = tokenRepository.expireOlderLive.mock.invocationCallOrder;
    expect(insertAt).toBeLessThan(sendAt);
    expect(sendAt).toBeLessThan(expireAt);
    const [userId, keep] = tokenRepository.expireOlderLive.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(keep.id).toBe('tok-1');
  });

  it('enqueue failure → 503 SEND_FAILED, the NEW token is expired, the old link is kept', async () => {
    const send = jest.fn().mockRejectedValue(new Error('Redis down'));
    const { service, tokenRepository } = build({ send });
    const error = await service.resend('user-1').catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(503);
    expect(codeOf(error)).toBe(EMAIL_VERIFICATION_SEND_FAILED);
    expect(tokenRepository.expire).toHaveBeenCalledWith('tok-1');
    expect(tokenRepository.expireOlderLive).not.toHaveBeenCalled();
  });

  it('enqueue that hangs → 503 after ENQUEUE_TIMEOUT_MS, old link kept', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    try {
      const send = jest.fn(() => new Promise<void>(() => undefined));
      const { service, tokenRepository } = build({ send });
      const pending = service.resend('user-1').catch((e: unknown) => e);
      await flush();
      jest.advanceTimersByTime(ENQUEUE_TIMEOUT_MS);
      const error = await pending;
      expect(codeOf(error)).toBe(EMAIL_VERIFICATION_SEND_FAILED);
      expect(tokenRepository.expireOlderLive).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('L1b — consumeAndVerify rolls back when the account cannot be marked', () => {
  function repoWith(usersRows: unknown[]) {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (/UPDATE email_verification_tokens/.test(sql)) {
          return [[{ user_id: 'user-1', email: EMAIL }], 1];
        }
        return [usersRows, usersRows.length];
      }),
    };
    const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)) };
    return { repo: new EmailVerificationTokenRepository(dataSource as never), manager };
  }

  it('users UPDATE touches one row → user id, and it is guarded by deleted_at_utc', async () => {
    const { repo, manager } = repoWith([{ id: 'user-1' }]);
    await expect(repo.consumeAndVerify('h')).resolves.toBe('user-1');
    const usersSql = manager.query.mock.calls.map((c) => c[0] as string).find((s) => /UPDATE users/.test(s))!;
    expect(usersSql).toMatch(/deleted_at_utc IS NULL/);
    expect(usersSql).toMatch(/email = \$2/);
  });

  it('users UPDATE touches zero rows → the transaction throws (rollback) and the caller gets null', async () => {
    const { repo } = repoWith([]);
    await expect(repo.consumeAndVerify('h')).resolves.toBeNull();
  });
});

describe('L1b — budgets', () => {
  it('resend has its OWN counter: it never spends the sign-up budget', async () => {
    const { redis, counters } = fakeRedis();
    const budget = new EmailBudgetService(
      redis,
      config({ EMAIL_VERIFICATION_DAILY_BUDGET: 1, EMAIL_VERIFICATION_RESEND_DAILY_BUDGET: 2 }),
    );
    expect(await budget.reserveVerification('resend')).toBe(true);
    expect(await budget.reserveVerification('resend')).toBe(true);
    expect(await budget.reserveVerification('resend')).toBe(false);
    expect(await budget.reserveVerification('signup')).toBe(true);
    expect([...counters.keys()].sort()).toEqual([
      expect.stringMatching(/^linkr:email-verification-budget:v1:/),
      expect.stringMatching(/^linkr:email-verification-resend-budget:v1:/),
    ]);
  });

  it('one WARN per day at 80 % of the sign-up cap, without any address', async () => {
    const { redis } = fakeRedis();
    const budget = new EmailBudgetService(redis, config({ EMAIL_VERIFICATION_DAILY_BUDGET: 10 }));
    logged.length = 0;
    for (let i = 0; i < 9; i += 1) await budget.reserveVerification('signup');
    expect(logged.filter((l) => l.includes('budget at 8/10'))).toHaveLength(1);
    expect(logged.join('\n')).not.toMatch(/@/);
  });

  it('boot: no warning with the defaults (200 + 40 + 20 leaves 40 of 300)', () => {
    logged.length = 0;
    new EmailBudgetService(fakeRedis().redis, config());
    expect(logged.filter((l) => l.includes('Email caps leave'))).toHaveLength(0);
  });

  it('boot: a WARNING (not a failure) when the caps leave fewer than 40 sends', () => {
    logged.length = 0;
    expect(
      () => new EmailBudgetService(fakeRedis().redis, config({ EMAIL_VERIFICATION_DAILY_BUDGET: 60 })),
    ).not.toThrow();
    expect(logged.filter((l) => l.includes('Email caps leave 20 of 300'))).toHaveLength(1);
  });
});

describe('logs', () => {
  it('resend and verify never log the address or the token', async () => {
    const { service, emailService } = build();
    await service.resend('user-1');
    const raw = new URL(emailService.send.mock.calls[0][0].vars.verifyUrl).searchParams.get('token')!;
    await service.verify(raw);
    const all = logged.join('\n');
    expect(all).not.toContain(EMAIL);
    expect(all).not.toContain(raw);
    expect(all).not.toContain(hashToken(raw));
  });
});

describe('EmailBudgetService — verification budget', () => {
  it('has its own cap and key; at the cap it refuses', async () => {
    const { redis, counters } = fakeRedis();
    const budget = new EmailBudgetService(redis, config({ EMAIL_VERIFICATION_DAILY_BUDGET: 2 }));
    expect(await budget.reserveVerification("signup")).toBe(true);
    expect(await budget.reserveVerification("signup")).toBe(true);
    expect(await budget.reserveVerification("signup")).toBe(false);
    const keys = [...counters.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^linkr:email-verification-budget:v1:\d{4}-\d{2}-\d{2}$/);
  });

  it('is essential: not blocked or counted by an exhausted notification budget, priority 1', async () => {
    const { redis, counters } = fakeRedis();
    const budget = new EmailBudgetService(redis, config({ EMAIL_DAILY_BUDGET: 1 }));
    await budget.allow('direct-booking');
    await budget.allow('direct-booking'); // notification budget now exhausted
    expect(await budget.allow('email-verification')).toBe(true);
    expect([...counters.values()]).toEqual([2]);
    expect(budget.priorityFor('email-verification')).toBe(1);
  });

  it('fails open when Redis is down, like the other mails', async () => {
    const { redis } = fakeRedis({ down: true });
    const budget = new EmailBudgetService(redis, config());
    expect(await budget.reserveVerification("signup")).toBe(true);
  });
});

describe('password reset marks the address verified', () => {
  it('in the SAME transaction as the password change, with COALESCE', async () => {
    const queries: string[] = [];
    let transactions = 0;
    const manager = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('password_reset_tokens')) return [[{ user_id: 'user-1' }], 1];
        if (sql.includes('user_auth_providers')) return [[{ id: 'p' }], 1];
        return [[], 1];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => {
        transactions += 1;
        return fn(manager);
      }),
    };
    const repo = new PasswordResetTokenRepository({} as never, dataSource as never);
    await expect(repo.consumeAndSetPassword('h', 'hash')).resolves.toBe('user-1');
    expect(transactions).toBe(1);
    const usersUpdate = queries.find((q) => /UPDATE users/.test(q))!;
    expect(usersUpdate).toMatch(
      /email_verified_at_utc\s*=\s*COALESCE\(email_verified_at_utc,\s*now\(\)\)/,
    );
    expect(usersUpdate).toMatch(/sessions_invalidated_at_utc/);
  });
});
