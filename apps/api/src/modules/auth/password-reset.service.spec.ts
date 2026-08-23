import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  InvalidResetTokenException,
  PasswordResetService,
  RESET_TOKEN_TTL_MINUTES,
  hashToken,
} from './password-reset.service';
import { NoEmailPasswordProviderError } from './password-reset-token.repository';
import { AuthProviderType } from '../users/enums/auth-provider-type.enum';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const userWithPassword = {
  id: 'user-1',
  email: 'carol@linkr.test',
  firstName: 'Carol',
  authProviders: [
    { providerType: AuthProviderType.EMAIL_PASSWORD, passwordHash: '$argon2id$x' },
  ],
};

function build() {
  const usersRepository = { findByEmailWithAuthProviders: jest.fn() };
  const tokenRepository = {
    rotateAndInsert: jest.fn().mockResolvedValue(undefined),
    consumeAndSetPassword: jest.fn(),
  };
  const authService = {
    hashPassword: jest.fn().mockResolvedValue('$argon2id$new'),
  };
  const emailService = { send: jest.fn().mockResolvedValue(undefined) };
  const configService = { getOrThrow: jest.fn().mockReturnValue('http://localhost:3001') };

  const service = new PasswordResetService(
    usersRepository as never,
    tokenRepository as never,
    authService as never,
    emailService as never,
    configService as never,
  );

  return { service, usersRepository, tokenRepository, authService, emailService };
}

describe('PasswordResetService.requestReset', () => {
  it('is silent and side-effect free for an unknown address', async () => {
    const { service, usersRepository, tokenRepository, emailService } = build();
    usersRepository.findByEmailWithAuthProviders.mockResolvedValue(null);

    // Must RESOLVE, not throw: the controller answers 202 either way, and an
    // error path here would be a branch a caller could observe (A-2.12).
    await expect(service.requestReset('ghost@linkr.test')).resolves.toBeUndefined();

    expect(tokenRepository.rotateAndInsert).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('sends nothing to an account that has no password to reset', async () => {
    const { service, usersRepository, tokenRepository, emailService } = build();
    usersRepository.findByEmailWithAuthProviders.mockResolvedValue({
      ...userWithPassword,
      authProviders: [{ providerType: AuthProviderType.GOOGLE, passwordHash: null }],
    });

    await service.requestReset('carol@linkr.test');

    // A reset link would promise what the consume path cannot deliver.
    expect(tokenRepository.rotateAndInsert).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('normalises the address before looking it up', async () => {
    const { service, usersRepository } = build();
    usersRepository.findByEmailWithAuthProviders.mockResolvedValue(null);

    await service.requestReset('  CAROL@Linkr.TEST  ');

    expect(usersRepository.findByEmailWithAuthProviders).toHaveBeenCalledWith(
      'carol@linkr.test',
    );
  });

  it('stores ONLY the hash, and mails ONLY the raw token', async () => {
    const { service, usersRepository, tokenRepository, emailService } = build();
    usersRepository.findByEmailWithAuthProviders.mockResolvedValue(userWithPassword);

    await service.requestReset('carol@linkr.test');

    const [, storedHash, expiresAt] = tokenRepository.rotateAndInsert.mock.calls[0];
    const { resetUrl } = emailService.send.mock.calls[0][0].vars;
    const rawToken = new URL(resetUrl).searchParams.get('token') as string;

    // The heart of A-2.2/A-2.4: what is persisted is the digest of what was sent,
    // and the raw value appears nowhere in the write.
    expect(storedHash).toBe(sha256(rawToken));
    expect(storedHash).not.toContain(rawToken);
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    // 32 bytes → 43 base64url chars, unpadded.
    expect(rawToken).toHaveLength(43);

    const ttlMs = (expiresAt as Date).getTime() - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(RESET_TOKEN_TTL_MINUTES * 60_000);
    expect(ttlMs).toBeGreaterThan((RESET_TOKEN_TTL_MINUTES - 1) * 60_000);
  });

  it('mails a distinct token every time', async () => {
    const { service, usersRepository, emailService } = build();
    usersRepository.findByEmailWithAuthProviders.mockResolvedValue(userWithPassword);

    await service.requestReset('carol@linkr.test');
    await service.requestReset('carol@linkr.test');

    const [first, second] = emailService.send.mock.calls.map(
      (call) => call[0].vars.resetUrl,
    );
    expect(first).not.toEqual(second);
  });

  it('builds an absolute link on the configured base, with no double slash', async () => {
    const { service, usersRepository, emailService } = build();
    usersRepository.findByEmailWithAuthProviders.mockResolvedValue(userWithPassword);

    await service.requestReset('carol@linkr.test');

    const { resetUrl } = emailService.send.mock.calls[0][0].vars;
    expect(resetUrl).toMatch(/^http:\/\/localhost:3001\/reset-password\?token=/);
  });

  it('suppresses the SEND past the cap, and still resolves', async () => {
    const { service, usersRepository, emailService } = build();
    usersRepository.findByEmailWithAuthProviders.mockResolvedValue(userWithPassword);

    for (let i = 0; i < 5; i += 1) {
      await service.requestReset('carol@linkr.test');
    }
    expect(emailService.send).toHaveBeenCalledTimes(5);

    // The cap suppresses the mail. It must NOT surface as an error, or the
    // silence becomes observable and the 202 stops being constant (A-2.17).
    await expect(service.requestReset('carol@linkr.test')).resolves.toBeUndefined();
    expect(emailService.send).toHaveBeenCalledTimes(5);
  });

  it('caps per address, not globally', async () => {
    const { service, usersRepository, emailService } = build();
    usersRepository.findByEmailWithAuthProviders.mockResolvedValue(userWithPassword);

    for (let i = 0; i < 6; i += 1) {
      await service.requestReset('carol@linkr.test');
    }
    expect(emailService.send).toHaveBeenCalledTimes(5);

    // A different address has its own budget — one user cannot mute another.
    await service.requestReset('dave@linkr.test');
    expect(emailService.send).toHaveBeenCalledTimes(6);
  });

  it('NEVER writes the raw token to a log (A-2.18)', async () => {
    const { service, usersRepository, emailService } = build();
    usersRepository.findByEmailWithAuthProviders.mockResolvedValue(userWithPassword);

    // Capture every level: a token leaked at `warn` is leaked just the same.
    const written: string[] = [];
    const levels = ['log', 'warn', 'error', 'debug', 'verbose'] as const;
    const spies = levels.map((level) =>
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          written.push(args.map(String).join(' '));
        }),
    );

    try {
      await service.requestReset('carol@linkr.test');

      const { resetUrl } = emailService.send.mock.calls[0][0].vars;
      const rawToken = new URL(resetUrl).searchParams.get('token') as string;

      // Something WAS logged — otherwise this test passes vacuously forever.
      expect(written.join('\n')).toContain('user-1');
      expect(written.join('\n')).not.toContain(rawToken);
      expect(written.join('\n')).not.toContain(resetUrl);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

describe('PasswordResetService.resetPassword', () => {
  it('looks the token up by its hash, never by its raw value', async () => {
    const { service, tokenRepository } = build();
    tokenRepository.consumeAndSetPassword.mockResolvedValue('user-1');

    await service.resetPassword('raw-token-value', 'sufficiently-long-pw');

    expect(tokenRepository.consumeAndSetPassword).toHaveBeenCalledWith(
      sha256('raw-token-value'),
      '$argon2id$new',
    );
  });

  it('hashes the password BEFORE opening the transaction', async () => {
    const { service, tokenRepository, authService } = build();
    tokenRepository.consumeAndSetPassword.mockResolvedValue('user-1');

    await service.resetPassword('raw', 'sufficiently-long-pw');

    // Argon2id takes tens of ms; holding the token's row lock across it would
    // serialise concurrent resets behind a CPU-bound hash for no benefit.
    expect(authService.hashPassword.mock.invocationCallOrder[0]).toBeLessThan(
      tokenRepository.consumeAndSetPassword.mock.invocationCallOrder[0],
    );
  });

  it('gives ONE indistinguishable error for every token failure', async () => {
    const { service, tokenRepository } = build();

    // Unknown / expired / consumed / rotated all arrive here as `null`.
    tokenRepository.consumeAndSetPassword.mockResolvedValue(null);
    const fromNull = await service
      .resetPassword('raw', 'sufficiently-long-pw')
      .catch((error: Error) => error);

    // An OAuth-only account rolls the transaction back and throws instead.
    tokenRepository.consumeAndSetPassword.mockRejectedValue(
      new NoEmailPasswordProviderError('user-1'),
    );
    const fromOauth = await service
      .resetPassword('raw', 'sufficiently-long-pw')
      .catch((error: Error) => error);

    expect(fromNull).toBeInstanceOf(InvalidResetTokenException);
    expect(fromOauth).toBeInstanceOf(InvalidResetTokenException);
    // Byte-identical: telling the two apart would leak that the account exists
    // AND how it signs in.
    expect((fromOauth as Error).message).toBe((fromNull as Error).message);
    expect((fromNull as InvalidResetTokenException).getStatus()).toBe(400);
  });

  it('names rotation first, because that is the common way to get here', async () => {
    const { service, tokenRepository } = build();
    tokenRepository.consumeAndSetPassword.mockResolvedValue(null);

    const error = await service
      .resetPassword('raw', 'sufficiently-long-pw')
      .catch((caught: Error) => caught);

    // A-2.20: the copy must explain the replaced link and offer the way out.
    expect((error as Error).message).toContain('remplacé');
    expect((error as Error).message).toContain('nouveau lien');
  });

  it('lets an unexpected failure through instead of masking it as a bad token', async () => {
    const { service, tokenRepository } = build();
    tokenRepository.consumeAndSetPassword.mockRejectedValue(
      new Error('connection terminated'),
    );

    // A database outage is not "your link expired". Collapsing it would send the
    // user to request a new link that also cannot work.
    await expect(
      service.resetPassword('raw', 'sufficiently-long-pw'),
    ).rejects.toThrow('connection terminated');
  });
});

describe('hashToken', () => {
  it('is plain SHA-256 hex — deterministic, so the lookup can be an index hit', () => {
    expect(hashToken('abc')).toBe(sha256('abc'));
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toHaveLength(64);
  });
});
