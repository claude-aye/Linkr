import * as Joi from 'joi';

const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  LOG_LEVEL: Joi.string()
    .valid('log', 'error', 'warn', 'debug', 'verbose')
    .default('log'),

  // JWT — access token
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),

  // JWT — refresh token (must differ from access secret)
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .invalid(Joi.ref('JWT_ACCESS_SECRET'))
    .required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Google OAuth (optional — 503 if absent at runtime)
  GOOGLE_OAUTH_CLIENT_ID: Joi.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: Joi.string().optional(),
  GOOGLE_OAUTH_CALLBACK_URL: Joi.string().uri().optional(),

  // Apple Sign-In (optional — 503 if absent at runtime)
  APPLE_OAUTH_CLIENT_ID: Joi.string().optional(),
  APPLE_OAUTH_TEAM_ID: Joi.string().optional(),
  APPLE_OAUTH_KEY_ID: Joi.string().optional(),
  APPLE_OAUTH_PRIVATE_KEY: Joi.string().optional(),
  APPLE_OAUTH_CALLBACK_URL: Joi.string().uri().optional(),

  // Storage (port/adapter) — local disk in dev, S3-compatible in prod.
  STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
  STORAGE_LOCAL_DIR: Joi.string().default('./storage/uploads'),
  // S3 vars become required when STORAGE_DRIVER=s3.
  STORAGE_BUCKET: Joi.string().when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  STORAGE_REGION: Joi.string().when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  STORAGE_ACCESS_KEY_ID: Joi.string().when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  STORAGE_SECRET_ACCESS_KEY: Joi.string().when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  // Optional custom endpoint for S3-compatible providers (e.g. Cloudflare R2).
  STORAGE_ENDPOINT: Joi.string().uri().optional(),

  // Geocoding (port/adapter) — Nominatim (OpenStreetMap) proxy for GET /geocode.
  // Provider + base URL mirror STORAGE_DRIVER's defaulted selection.
  GEOCODING_PROVIDER: Joi.string().valid('nominatim').default('nominatim'),
  NOMINATIM_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('https://nominatim.openstreetmap.org'),
  // Required (no default): Nominatim's ToS mandates a descriptive User-Agent
  // identifying THIS deployment + a real contact. A shipped default would make
  // every install share one fake UA (→ blocked), so it must be set explicitly.
  NOMINATIM_USER_AGENT: Joi.string().required(),

  // Stripe — required at boot (3.10a). Prefix checks catch swapped keys early.
  STRIPE_SECRET_KEY: Joi.string()
    .pattern(/^sk_/)
    .required()
    .messages({ 'string.pattern.base': 'STRIPE_SECRET_KEY must start with "sk_"' }),
  STRIPE_WEBHOOK_SECRET: Joi.string()
    .pattern(/^whsec_/)
    .required()
    .messages({
      'string.pattern.base': 'STRIPE_WEBHOOK_SECRET must start with "whsec_"',
    }),
  // Not used in 3.10a but validated so the env contract is complete.
  STRIPE_PUBLISHABLE_KEY: Joi.string()
    .pattern(/^pk_/)
    .required()
    .messages({
      'string.pattern.base': 'STRIPE_PUBLISHABLE_KEY must start with "pk_"',
    }),
  // DORMANT — the Account Links onboarding flow does not use Connect OAuth.
  STRIPE_CONNECT_CLIENT_ID: Joi.string().optional(),

  // Stripe Connect Express onboarding redirect targets (Account Links).
  CONNECT_ONBOARDING_RETURN_URL: Joi.string()
    .uri()
    .default('http://localhost:3000/connect/return'),
  CONNECT_ONBOARDING_REFRESH_URL: Joi.string()
    .uri()
    .default('http://localhost:3000/connect/refresh'),

  // Platform economics (3.10b) — required at boot, snapshotted on each payment.
  PLATFORM_COMMISSION_RATE_PERCENT: Joi.number().min(0).max(100).required(),
  PLATFORM_DEPOSIT_RATE_PERCENT: Joi.number().min(0).max(100).required(),
  PLATFORM_DEFAULT_CURRENCY: Joi.string()
    .length(3)
    .uppercase()
    .default('CAD'),
  // Hours a COMPLETED, non-contested request waits before the balance (80%)
  // auto-releases (3.10c). Required at boot.
  PLATFORM_AUTO_RELEASE_HOURS: Joi.number().integer().min(1).required(),

  // Outbound email (chantier A-1). Host and port are required with no default:
  // an email that quietly goes nowhere has no symptom, so a missing setting
  // must stop the boot rather than surface three days later as a user who
  // never got their message. .env.example carries the local Mailpit values.
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().required(),
  // false = plain connection, upgraded by STARTTLS when the relay offers it
  // (Mailpit, and port 587). Set true only for implicit TLS on port 465.
  SMTP_SECURE: Joi.boolean().default(false),
  // Optional: Mailpit does not authenticate. Paired by `.and(...)` below.
  SMTP_USER: Joi.string().optional(),
  SMTP_PASSWORD: Joi.string().optional(),
  // The sender identity belongs to the deployment, never to a caller. No
  // default, for the same reason as NOMINATIM_USER_AGENT: a shipped one would
  // have every install send from the same fake domain.
  // `tlds: { allow: false }` checks the SHAPE without checking the suffix
  // against the IANA root zone. Without it Joi rejects `.test` — the TLD
  // RFC 2606 reserves for exactly this use, which every test address in this
  // repo already uses — and copying .env.example would produce an API that
  // refuses to boot. It also matches how the rest of the codebase validates an
  // address: class-validator's @IsEmail() does not check the TLD list either.
  EMAIL_FROM_ADDRESS: Joi.string()
    .email({ tlds: { allow: false } })
    .required(),
  EMAIL_FROM_NAME: Joi.string().default('Linkr'),
})
  // Credentials go together or not at all. Half-configured auth would connect
  // anonymously and be refused at delivery — a failure that only shows up in a
  // worker log, long after boot would have been the cheap place to catch it.
  .and('SMTP_USER', 'SMTP_PASSWORD');

export function validate(config: Record<string, unknown>): Record<string, unknown> {
  const { error, value } = envSchema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: false,
  });

  if (error) {
    const messages = error.details.map((d) => d.message).join('\n  ');
    throw new Error(`Environment validation failed:\n  ${messages}`);
  }

  return value as Record<string, unknown>;
}
