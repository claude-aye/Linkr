import { SetMetadata } from '@nestjs/common';

/** Metadata key under which {@link RateLimit} stores its budget. */
export const RATE_LIMIT_KEY = 'linkr:rate-limit';

export interface RateLimitOptions {
  /** How many requests one caller may make inside the window. */
  limit: number;
  /** Length of the window, in seconds. */
  windowSeconds: number;
}

/**
 * Caps how often ONE CALLER may hit the decorated route.
 *
 * ⚠️ THE BUDGET LIVES AT THE CALL SITE, NOT IN THE ENVIRONMENT, AND THAT IS THE
 * WHOLE REASON THIS IS A DECORATOR. Different routes need genuinely different
 * budgets — an anonymous discovery search and an authenticated write are not the
 * same traffic — so a single global `RATE_LIMIT_MAX` env var would be the wrong
 * shape: it could only ever be right for one of them. Each route states its own
 * budget here, next to the handler whose cost it describes, and adding a second
 * protected route costs one decorator and no configuration.
 *
 * An undecorated route is untouched even where {@link RateLimitGuard} is
 * registered: no metadata means the guard returns immediately.
 */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);
