import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EmailVerifiedGuard } from './email-verified.guard';
import { UsersRepository } from '../../modules/users/users.repository';
import { EMAIL_NOT_VERIFIED } from '../../modules/auth/email-verification.exceptions';

function contextFor(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardWith(findById: jest.Mock) {
  const repo = { findById } as unknown as UsersRepository;
  const get = jest.fn().mockReturnValue(repo);
  const guard = new EmailVerifiedGuard({ get } as unknown as ModuleRef);
  return { guard, get };
}

const SUB = '6b0c3a0e-1111-4c3e-9d77-000000000001';

describe('EmailVerifiedGuard (L3)', () => {
  it('unconfirmed account → 403 with code EMAIL_NOT_VERIFIED', async () => {
    const { guard } = guardWith(jest.fn().mockResolvedValue({ id: SUB, emailVerifiedAtUtc: null }));
    const error = await guard.canActivate(contextFor({ sub: SUB })).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 403 });
    expect((error as { getResponse(): unknown }).getResponse()).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      code: EMAIL_NOT_VERIFIED,
      message: 'Confirm your email address to perform this action.',
    });
  });

  it('confirmed account → passes', async () => {
    const { guard } = guardWith(jest.fn().mockResolvedValue({ id: SUB, emailVerifiedAtUtc: new Date() }));
    await expect(guard.canActivate(contextFor({ sub: SUB }))).resolves.toBe(true);
  });

  it('unknown (or soft-deleted) account → 401', async () => {
    const { guard } = guardWith(jest.fn().mockResolvedValue(null));
    await expect(guard.canActivate(contextFor({ sub: SUB }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('no authenticated caller → 401, no database read', async () => {
    const findById = jest.fn();
    const { guard } = guardWith(findById);
    await expect(guard.canActivate(contextFor(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findById).not.toHaveBeenCalled();
  });

  it('reads the DATABASE by sub — a claim in the token is ignored', async () => {
    const findById = jest.fn().mockResolvedValue({ id: SUB, emailVerifiedAtUtc: null });
    const { guard } = guardWith(findById);
    const claims = { sub: SUB, email: 'x@linkr.test', emailVerified: true, emailVerifiedAtUtc: new Date().toISOString() };
    await expect(guard.canActivate(contextFor(claims))).rejects.toMatchObject({ status: 403 });
    expect(findById).toHaveBeenCalledWith(SUB);
  });

  it('reads the database on EVERY call (no cached verdict)', async () => {
    const findById = jest
      .fn()
      .mockResolvedValueOnce({ id: SUB, emailVerifiedAtUtc: null })
      .mockResolvedValueOnce({ id: SUB, emailVerifiedAtUtc: new Date() });
    const { guard, get } = guardWith(findById);
    await expect(guard.canActivate(contextFor({ sub: SUB }))).rejects.toMatchObject({ status: 403 });
    await expect(guard.canActivate(contextFor({ sub: SUB }))).resolves.toBe(true);
    expect(findById).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith(UsersRepository, { strict: false });
  });
});
