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
