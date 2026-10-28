import { validate } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  NOMINATIM_USER_AGENT: 'Linkr/test (ops@example.com)',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
  PLATFORM_COMMISSION_RATE_PERCENT: '10',
  PLATFORM_DEPOSIT_RATE_PERCENT: '20',
  PLATFORM_AUTO_RELEASE_HOURS: '72',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  EMAIL_FROM_ADDRESS: 'no-reply@example.com',
};

const prod = {
  ...base,
  NODE_ENV: 'production',
  WEB_APP_BASE_URL: 'https://app.example.com',
  CONNECT_ONBOARDING_RETURN_URL: 'https://app.example.com/dashboard/paiements/retour',
  CONNECT_ONBOARDING_REFRESH_URL: 'https://app.example.com/dashboard/paiements/reprise',
};

describe('production environment validation', () => {
  it('accepts a complete production config', () => {
    expect(() => validate(prod)).not.toThrow();
  });

  it.each([
    'WEB_APP_BASE_URL',
    'CONNECT_ONBOARDING_RETURN_URL',
    'CONNECT_ONBOARDING_REFRESH_URL',
  ])('refuses production without %s (no localhost default)', (name) => {
    const { [name]: _omitted, ...rest } = prod as Record<string, string>;
    expect(() => validate(rest)).toThrow(new RegExp(`${name} must be set explicitly`));
  });

  it('refuses LOG_LEVEL=debug in production', () => {
    expect(() => validate({ ...prod, LOG_LEVEL: 'debug' })).toThrow(/LOG_LEVEL must not be "debug"/);
  });

  it('still reports a missing mandatory variable in production, without leaking secrets', () => {
    const { DATABASE_URL: _d, ...rest } = prod;
    let message = '';
    try {
      validate({ ...rest, LOG_LEVEL: 'debug' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/LOG_LEVEL/);
    expect(message).not.toContain(base.JWT_ACCESS_SECRET);
    expect(message).not.toContain(base.STRIPE_SECRET_KEY);
  });

  it('keeps development permissive: localhost defaults and debug logs are fine', () => {
    expect(() => validate({ ...base, LOG_LEVEL: 'debug' })).not.toThrow();
    expect(() => validate({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });
});
