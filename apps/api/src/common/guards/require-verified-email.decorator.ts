import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { EmailVerifiedGuard } from './email-verified.guard';

/** Marker read by the classification spec; the guard itself does not need it. */
export const REQUIRE_VERIFIED_EMAIL_KEY = 'requireVerifiedEmail';

/** Swagger text of the 403 every guarded route documents. */
export const EMAIL_NOT_VERIFIED_RESPONSE_DESCRIPTION =
  'Email address not confirmed (code EMAIL_NOT_VERIFIED).';

/**
 * L3 — this write reaches a third party: the caller's address must be
 * confirmed (`users.email_verified_at_utc` non-null, read from the database).
 *
 * Route by route, never class-wide and never global. Every write route of the
 * API is either decorated with this or listed, with a one-line reason, in
 * `UNGUARDED_WRITE_ROUTES` (`require-verified-email.spec.ts`): an unclassified
 * new write route fails that spec. Rule N2: following up work or a payment
 * already engaged (start, complete, confirm, contest, retry a deposit, cancel,
 * decline) is NEVER guarded.
 *
 * The 403 is documented by an explicit `@ApiResponse` on each route, merged
 * with any 403 the route already documents.
 */
export const RequireVerifiedEmail = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true), UseGuards(EmailVerifiedGuard));

/** For a route that already documents a 403: one description covering both causes. */
export function withEmailNotVerified(existing403: string): string {
  return `${existing403.replace(/\.$/, '')}; or the email address is not confirmed (code EMAIL_NOT_VERIFIED).`;
}
