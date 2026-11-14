import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dtos/signup.dto';
import { CURRENT_TERMS_VERSION } from './terms-version';

/**
 * Proof of consent at signup (PR L2).
 *
 * Two halves, and both are load-bearing:
 *   - the DTO refuses a signup without the boolean `true` and the CURRENT
 *     version — at the real `ValidationPipe`, with `main.ts`'s options, because
 *     the strictness of `@Equals` (no coercion of `"true"`) is exactly what is
 *     under test;
 *   - the service records the version AND a date the SERVER chose, in the very
 *     call that creates the user — never a date from the request.
 */

// Same options as `main.ts`. `transform: true` matters here: it is what would
// coerce `"true"` if any transformer were in play — `@Equals` must still say no.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: SignupDto, data: '' };

function validBody(): Record<string, unknown> {
  return {
    email: 'smoke-l2-spec@linkr.test',
    password: 'Password123!',
    firstName: 'Léa',
    lastName: 'Test',
    countryCode: 'CA',
    subdivisionCode: 'CA-QC',
    preferredCurrency: 'CAD',
    acceptTerms: true,
    termsVersion: CURRENT_TERMS_VERSION,
  };
}

async function messagesFor(body: Record<string, unknown>): Promise<string[]> {
  try {
    await pipe.transform(body, metadata);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    const response = (err as BadRequestException).getResponse() as { message: string[] };
    return response.message;
  }
  return [];
}

describe('SignupDto — terms acceptance (PR L2)', () => {
  it('accepts a complete body', async () => {
    await expect(pipe.transform(validBody(), metadata)).resolves.toBeInstanceOf(SignupDto);
  });

  it('refuses a body without acceptTerms', async () => {
    const body = validBody();
    delete body.acceptTerms;
    expect(await messagesFor(body)).toContain('acceptTerms must be true');
  });

  it('refuses acceptTerms: false', async () => {
    expect(await messagesFor({ ...validBody(), acceptTerms: false })).toContain(
      'acceptTerms must be true',
    );
  });

  it('refuses acceptTerms: "true" (a string is not consent)', async () => {
    expect(await messagesFor({ ...validBody(), acceptTerms: 'true' })).toContain(
      'acceptTerms must be true',
    );
  });

  it('refuses a body without termsVersion', async () => {
    const body = validBody();
    delete body.termsVersion;
    expect(await messagesFor(body)).toContain(
      `termsVersion must be ${CURRENT_TERMS_VERSION}`,
    );
  });

  it('refuses a version that is not the current one', async () => {
    expect(await messagesFor({ ...validBody(), termsVersion: '2026-01-01' })).toContain(
      `termsVersion must be ${CURRENT_TERMS_VERSION}`,
    );
  });

  it('refuses a client-supplied acceptance date (no such field)', async () => {
    const messages = await messagesFor({
      ...validBody(),
      termsAcceptedAtUtc: '2020-01-01T00:00:00.000Z',
    });
    expect(messages).toContain('property termsAcceptedAtUtc should not exist');
  });
});

describe('AuthService.signup — records the acceptance (PR L2)', () => {
  function build() {
    // Returns the row as the database would: WITH the two columns set, so the
    // "never exposed" test proves the mapper drops them rather than never seeing them.
    const createWithEmailPassword = jest
      .fn()
      .mockImplementation(async (data, _hash, acceptance) => ({
        id: 'user-1',
        ...data,
        termsAcceptedAtUtc: acceptance.acceptedAtUtc,
        termsVersion: acceptance.version,
      }));
    const usersRepository = {
      findByEmail: jest.fn().mockResolvedValue(null),
      createWithEmailPassword,
    };
    const jwtService = { sign: jest.fn().mockReturnValue('signed') };
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('secret'),
      get: jest.fn(),
    };
    const service = new AuthService(
      jwtService as never,
      configService as never,
      usersRepository as never,
    );
    // Argon2 is not what is under test, and it is slow.
    jest.spyOn(service, 'hashPassword').mockResolvedValue('hash');
    return { service, createWithEmailPassword };
  }

  it('passes the current version and a SERVER date to the user-creating call', async () => {
    const { service, createWithEmailPassword } = build();
    const before = Date.now();

    await service.signup(validBody() as unknown as SignupDto);

    const after = Date.now();
    expect(createWithEmailPassword).toHaveBeenCalledTimes(1);
    const [, , acceptance] = createWithEmailPassword.mock.calls[0];
    expect(acceptance.version).toBe(CURRENT_TERMS_VERSION);
    expect(acceptance.acceptedAtUtc).toBeInstanceOf(Date);
    expect(acceptance.acceptedAtUtc.getTime()).toBeGreaterThanOrEqual(before);
    expect(acceptance.acceptedAtUtc.getTime()).toBeLessThanOrEqual(after);
  });

  it('ignores a date smuggled past the DTO — the server clock wins', async () => {
    // The DTO forbids the field; this proves the service would not read it even
    // if something upstream let it through.
    const { service, createWithEmailPassword } = build();
    const before = Date.now();

    await service.signup({
      ...validBody(),
      termsAcceptedAtUtc: new Date('2020-01-01T00:00:00.000Z'),
    } as unknown as SignupDto);

    const [, , acceptance] = createWithEmailPassword.mock.calls[0];
    expect(acceptance.acceptedAtUtc.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('never exposes the acceptance in the response', async () => {
    const { service } = build();
    const response = await service.signup(validBody() as unknown as SignupDto);
    expect(response.user).not.toHaveProperty('termsVersion');
    expect(response.user).not.toHaveProperty('termsAcceptedAtUtc');
  });
});
