import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Strategy } from 'passport-local';
import request from 'supertest';

import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { AUTH_RATE_LIMITS } from './auth-rate-limits';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';

/**
 * Pins two properties of `POST /auth/login` that NO unit test can reach, because
 * both are behaviours of the framework wiring rather than of any one function:
 *
 *  1. `RateLimitGuard` runs BEFORE `LocalAuthGuard`, so a WRONG password spends
 *     budget. Swap the two names in the controller's single `@UseGuards(...)`
 *     and every assertion about the 429 below fails — which is the point. Were
 *     the order reversed, a failed sign-in would 401 out of `LocalAuthGuard`
 *     before the counter was ever touched, and the limiter would cap only the
 *     traffic that already had valid credentials.
 *
 *  2. The budget is per CALLER ADDRESS, and `trust proxy` is what makes that
 *     address the visitor rather than the web tier. Every browser reaches this
 *     API through the Next server, so without it one bucket is shared by
 *     everyone and the first caller to spend it locks out the rest.
 *
 * The strategy below always rejects: every request in this file is a failed
 * sign-in, so anything that gets counted was counted on the failure path.
 */
class AlwaysRejectsLocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor() {
    super({ usernameField: 'email' });
  }

  validate(): never {
    throw new UnauthorizedException('Invalid email or password');
  }
}

const WRONG = { email: 'nobody@linkr.test', password: 'wrong-password' };

/** Distinct caller addresses; loopback is trusted, so these are believed. */
const CALLER_A = '203.0.113.10';
const CALLER_B = '198.51.100.20';

describe('AuthController — login rate limiting', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [AuthController],
      providers: [
        AlwaysRejectsLocalStrategy,
        RateLimitGuard,
        // Never reached: the strategy rejects before the handler body runs.
        { provide: AuthService, useValue: { login: jest.fn(), signup: jest.fn() } },
        { provide: PasswordResetService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Mirrors `main.ts`. Without it `request.ip` is the socket peer for every
    // caller and the two addresses below would share one budget.
    (app as NestExpressApplication).set('trust proxy', 'loopback');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** One failed sign-in from `ip`. */
  const failedLogin = (ip: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send(WRONG);

  it('counts a WRONG password against the budget', async () => {
    const { limit } = AUTH_RATE_LIMITS.LOGIN;

    // Every one of these is rejected by the strategy...
    for (let i = 0; i < limit; i += 1) {
      const response = await failedLogin(CALLER_A);
      expect(response.status).toBe(401);
    }

    // ...and yet the budget is spent. This is the whole assertion: if the
    // rate-limit guard ran after the auth guard, this would still be a 401.
    const exhausted = await failedLogin(CALLER_A);
    expect(exhausted.status).toBe(429);
  });

  it('answers the exhausted caller with a Retry-After in whole seconds', async () => {
    const { limit, windowSeconds } = AUTH_RATE_LIMITS.LOGIN;

    for (let i = 0; i < limit; i += 1) {
      await failedLogin(CALLER_A);
    }
    const exhausted = await failedLogin(CALLER_A);

    expect(exhausted.status).toBe(429);
    // A delta in seconds, never an HTTP date — this is what the front reads to
    // say HOW LONG rather than just "later".
    const retryAfter = Number(exhausted.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(windowSeconds);
  });

  it('meters each caller address separately', async () => {
    const { limit } = AUTH_RATE_LIMITS.LOGIN;

    for (let i = 0; i < limit; i += 1) {
      await failedLogin(CALLER_A);
    }
    expect((await failedLogin(CALLER_A)).status).toBe(429);

    // The second address is untouched. Were `trust proxy` not set — or were the
    // forwarded address not reaching `request.ip` — this would already be 429,
    // which is exactly the shared bucket this chantier exists to remove.
    expect((await failedLogin(CALLER_B)).status).toBe(401);
  });

  it('ignores a forwarded address arriving from an UNTRUSTED peer', async () => {
    const { limit } = AUTH_RATE_LIMITS.LOGIN;
    // Nothing is trusted now, so `X-Forwarded-For` is ignored and every caller
    // falls back to the socket peer: failing CLOSED. Two "different" addresses
    // therefore share one budget rather than each getting a fresh one.
    (app as NestExpressApplication).set('trust proxy', false);

    for (let i = 0; i < limit; i += 1) {
      await failedLogin(CALLER_A);
    }
    expect((await failedLogin(CALLER_B)).status).toBe(429);
  });
});
