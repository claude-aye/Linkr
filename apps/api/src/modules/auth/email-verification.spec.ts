import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { EmailBudgetService } from '../../common/email/email-budget.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SignupDto } from './dtos/signup.dto';
import {
  EMAIL_VERIFICATION_BUDGET_EXHAUSTED,
  EMAIL_VERIFICATION_TOKEN_INVALID,
} from './email-verification.exceptions';
import {
  EmailVerificationService,
  RESEND_LIMITS,
  VERIFY_EMAIL_PATH,
} from './email-verification.service';
import { PasswordResetTokenRepository } from './password-reset-token.repository';
import { hashToken } from './token-hash';

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
  const tokenRepository = {
    rotateAndInsert: jest.fn().mockResolvedValue(undefined),
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
    expect(tokenRepository.rotateAndInsert).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('rotates with the account address and queues the essential template with the fixed link', async () => {
    const { service, tokenRepository, emailService } = build();
    await expect(service.resend('user-1')).resolves.toBe('SENT');
    const [userId, email, tokenHash, expiresAt] = tokenRepository.rotateAndInsert.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(email).toBe(EMAIL);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const ttl = (expiresAt as Date).getTime() - Date.now();
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
    const [a, b] = tokenRepository.rotateAndInsert.mock.calls.map((c) => c[2]);
    expect(a).not.toBe(b);
  });

  it('budget spent → 503 with the stable code, and NO token created', async () => {
    const { service, tokenRepository, emailService } = build({ budgetAllows: false });
    const error = await service.resend('user-1').catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(503);
    expect(codeOf(error)).toBe(EMAIL_VERIFICATION_BUDGET_EXHAUSTED);
    expect(tokenRepository.rotateAndInsert).not.toHaveBeenCalled();
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
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(response.user.emailVerified).toBe(false);
  });

  it('a send failure does NOT fail the sign-up, and the log carries neither address nor token', async () => {
    const send = jest.fn().mockRejectedValue(new Error(`SMTP refused ${EMAIL}`));
    const { service: verification } = build({ send });
    const { service } = buildSignup(verification);
    await expect(service.signup(body)).resolves.toHaveProperty('accessToken');
    const sentUrl = send.mock.calls[0][0].vars.verifyUrl as string;
    const raw = new URL(sentUrl).searchParams.get('token')!;
    expect(logged.some((l) => l.includes('could not be queued'))).toBe(true);
    expect(logged.join('\n')).not.toContain(EMAIL);
    expect(logged.join('\n')).not.toContain(raw);
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
    expect(await budget.reserveVerification()).toBe(true);
    expect(await budget.reserveVerification()).toBe(true);
    expect(await budget.reserveVerification()).toBe(false);
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
    expect(await budget.reserveVerification()).toBe(true);
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
