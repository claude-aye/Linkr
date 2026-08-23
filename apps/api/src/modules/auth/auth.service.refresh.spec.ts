import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TokenType } from './enums/token-type.enum';
import { JwtPayload } from './interfaces/jwt-payload.interface';

/**
 * Session expulsion (A-2.10): `refresh` must refuse any token issued before
 * `users.sessions_invalidated_at_utc`.
 *
 * The whole point of this file is the SECOND-GRANULARITY boundary. JWT `iat` is
 * whole seconds; the column is a millisecond timestamp. Get the comparison wrong
 * and the failure is not loud — it silently expels the token the user just
 * received from their own reset.
 */
function build(sessionsInvalidatedAtUtc: Date, payload: Partial<JwtPayload> = {}) {
  const usersRepository = {
    findById: jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'carol@linkr.test',
      sessionsInvalidatedAtUtc,
    }),
  };
  const jwtService = {
    verify: jest.fn().mockReturnValue({
      sub: 'user-1',
      email: 'carol@linkr.test',
      type: TokenType.REFRESH,
      ...payload,
    }),
    sign: jest.fn().mockReturnValue('signed'),
  };
  const configService = { getOrThrow: jest.fn().mockReturnValue('secret'), get: jest.fn() };

  return new AuthService(
    jwtService as never,
    configService as never,
    usersRepository as never,
  );
}

/** A bound whose millisecond part is non-zero — the case that exposes the trap. */
const BOUND = new Date('2026-08-23T12:00:00.750Z');
const BOUND_SECONDS = Math.floor(BOUND.getTime() / 1000); // 1787832000

describe('AuthService.refresh — session expulsion', () => {
  it('refuses a token issued before the bound', async () => {
    const service = build(BOUND, { iat: BOUND_SECONDS - 1 });
    await expect(service.refresh('rt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ACCEPTS a token issued in the SAME SECOND as the bound', async () => {
    // ⚠️ THE TRAP. The bound is …00.750; the token was issued at …00.000, which
    // in milliseconds is BEFORE it. Comparing raw milliseconds would reject this
    // token — and this is exactly the token a user receives from the reset they
    // just performed. Flooring the bound to seconds is what makes it survive.
    const service = build(BOUND, { iat: BOUND_SECONDS });
    await expect(service.refresh('rt')).resolves.toEqual({
      accessToken: 'signed',
      refreshToken: 'signed',
    });
  });

  it('accepts a token issued after the bound', async () => {
    const service = build(BOUND, { iat: BOUND_SECONDS + 60 });
    await expect(service.refresh('rt')).resolves.toBeDefined();
  });

  it('refuses a token with no iat rather than trusting it', async () => {
    // Every token this service signs carries an `iat`; one without is not a
    // token this service minted normally, so it is not one to renew.
    const service = build(BOUND, { iat: undefined });
    await expect(service.refresh('rt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('says the same thing as an ordinary expiry', async () => {
    const service = build(BOUND, { iat: BOUND_SECONDS - 1 });
    const error = await service.refresh('rt').catch((caught: Error) => caught);

    // "Expelled" and "expired" mean the same thing to a client: sign in again.
    expect((error as Error).message).toBe('Invalid or expired refresh token');
  });
});
