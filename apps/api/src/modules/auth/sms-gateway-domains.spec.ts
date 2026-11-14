import { AuthService } from './auth.service';
import { SignupDto } from './dtos/signup.dto';
import {
  EMAIL_DOMAIN_NOT_ALLOWED,
  EmailDomainNotAllowedException,
  SMS_GATEWAY_DOMAINS,
  isSmsGatewayAddress,
} from './sms-gateway-domains';
import { CURRENT_TERMS_VERSION } from './terms-version';

/** D7 — text-message gateway addresses are refused at sign-up. */

describe('isSmsGatewayAddress', () => {
  it.each(SMS_GATEWAY_DOMAINS.map((d) => [d]))('refuses %s', (domain) => {
    expect(isSmsGatewayAddress(`5145551234@${domain}`)).toBe(true);
  });

  it.each([
    ['5145551234@TMOMAIL.NET'],
    ['5145551234@Vtext.Com'],
    ['5145551234@txt.BELL.ca'],
    ['5145551234@tmomail.net.'],
    ['  5145551234@vtext.com  '],
  ])('ignores case and stray spaces/dot: %s', (email) => {
    expect(isSmsGatewayAddress(email)).toBe(true);
  });

  it.each([['x@mms.tmomail.net'], ['x@a.b.vtext.com'], ['x@foo.msg.telus.com']])(
    'refuses a subdomain of a listed gateway: %s',
    (email) => {
      expect(isSmsGatewayAddress(email)).toBe(true);
    },
  );

  it('compares the part after the LAST @', () => {
    expect(isSmsGatewayAddress('"a@gmail.com"@vtext.com')).toBe(true);
    expect(isSmsGatewayAddress('"a@vtext.com"@gmail.com')).toBe(false);
  });

  it.each([
    ['someone@gmail.com'],
    ['someone@yahoo.com'],
    ['someone@yahoo.ca'],
    ['someone@outlook.com'],
    ['someone@hotmail.com'],
    ['someone@videotron.ca'],
    ['someone@bell.ca'],
    ['someone@telus.com'],
    ['someone@telus.net'],
    ['someone@google.com'],
    ['someone@fi.google.com'],
    ['someone@plomberie-abc.ca'],
    ['someone@linkrapp.com'],
    // Domains that merely END with a listed name, without a dot boundary.
    ['someone@notvtext.com'],
    ['someone@xtmomail.net'],
    // Left out of v1 on purpose (may host real mailboxes).
    ['someone@fido.ca'],
    ['someone@mailmymobile.net'],
    ['someone@vmobl.com'],
    ['someone@vmpix.com'],
    ['someone@smtext.com'],
  ])('accepts %s', (email) => {
    expect(isSmsGatewayAddress(email)).toBe(false);
  });

  it('accepts what is not an address at all (format is the DTO’s job)', () => {
    expect(isSmsGatewayAddress('no-at-sign')).toBe(false);
    expect(isSmsGatewayAddress('trailing@')).toBe(false);
  });
});

describe('AuthService.signup — gateway addresses', () => {
  function build() {
    const findByEmail = jest.fn().mockResolvedValue(null);
    const createWithEmailPassword = jest
      .fn()
      .mockImplementation(async (data) => ({ id: 'user-1', ...data }));
    const service = new AuthService(
      { sign: jest.fn().mockReturnValue('signed') } as never,
      { getOrThrow: jest.fn().mockReturnValue('secret'), get: jest.fn() } as never,
      { findByEmail, createWithEmailPassword } as never,
    );
    jest.spyOn(service, 'hashPassword').mockResolvedValue('hash');
    return { service, findByEmail, createWithEmailPassword };
  }

  function body(email: string): SignupDto {
    return {
      email,
      password: 'Password123!',
      firstName: 'Léa',
      lastName: 'Test',
      countryCode: 'CA',
      subdivisionCode: 'CA-QC',
      preferredCurrency: 'CAD',
      acceptTerms: true,
      termsVersion: CURRENT_TERMS_VERSION,
    } as SignupDto;
  }

  it('refuses with 400 EMAIL_DOMAIN_NOT_ALLOWED and touches nothing', async () => {
    const m = build();
    const err = await m.service.signup(body('5145551234@VTEXT.com')).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EmailDomainNotAllowedException);
    const ex = err as EmailDomainNotAllowedException;
    expect(ex.getStatus()).toBe(400);
    const response = ex.getResponse() as { code: string; message: string };
    expect(response.code).toBe(EMAIL_DOMAIN_NOT_ALLOWED);
    expect(response.message).toBe(
      'Cette adresse ne peut pas recevoir nos courriels. Utilisez une adresse courriel ordinaire.',
    );
    // The body never carries the address.
    expect(JSON.stringify(response)).not.toContain('5145551234');

    expect(m.findByEmail).not.toHaveBeenCalled();
    expect(m.createWithEmailPassword).not.toHaveBeenCalled();
  });

  it('lets an ordinary address through', async () => {
    const m = build();
    await expect(m.service.signup(body('lea@gmail.com'))).resolves.toBeDefined();
    expect(m.createWithEmailPassword).toHaveBeenCalledTimes(1);
  });
});
