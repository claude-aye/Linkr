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
});

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
